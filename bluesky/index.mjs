import hasFlag from "has-flag";
import { config } from "dotenv";
import blue from "@atproto/api";
import { queue } from "async";
import fetch from "node-fetch";
import { parse } from "url";
import _ from "underscore.string";
import moment from "moment";

const willPostToBluesky = process.env.NODE_ENV === "production";

const { RichText, BskyAgent } = blue;

const startup = Date.now();
let considerPostsAfter = startup;

// when we're testing we can start up with `node index.mjs --with-backlog`
// to go back 24 hours to get a few extra posts to work with
if (!willPostToBluesky && hasFlag("with-backlog")) {
  considerPostsAfter -= 24 * 60 * 60 * 1000;
}

let latest = considerPostsAfter;

config();

let agent;
if (willPostToBluesky) {
  agent = new BskyAgent({ service: "https://bsky.social/" });
  await agent.login({
    identifier: process.env.BLUESKY_BOT_EMAIL,
    password: process.env.BLUESKY_BOT_PASSWORD,
  });
}

process.env.POST_LENGTH ??= 140;
process.env.BODY_NAME_LENGTH ??= 30;
process.env.USER_NAME_LENGTH ??= 30;
const delay = parseInt(process.env.DELAY, 10) || 5;

console.log(`
BLUESKY_BOT_EMAIL: ${process.env.BLUESKY_BOT_EMAIL}
BLUESKY_BOT_PASSWORD: ${
  process.env.BLUESKY_BOT_PASSWORD ? "SUPPLIED" : "MISSING"
}
FEED_URL: ${process.env.FEED_URL}
DELAY: ${process.env.DELAY}
POST_LENGTH: ${process.env.POST_LENGTH}
BODY_NAME_LENGTH: ${process.env.BODY_NAME_LENGTH}
USER_NAME_LENGTH: ${process.env.USER_NAME_LENGTH}
WILL_POST_TO_BLUESKY: ${willPostToBluesky}
`);

const humaniseStartDate = () => moment(considerPostsAfter).format("LLL");

const feedUrl = parse(process.env.FEED_URL);
// URL is t.co wrapped, short_url_length_https = 23, plus a space after the URL
const textLength = process.env.POST_LENGTH - 24;

const ignoredEventTypes = ["comment", "followup_sent"];

const workQueue = queue(async (entry, callback) => {
  const incoming = !!entry.incoming_message_id;
  const createdAt = moment(entry.created_at).valueOf();
  const url = `${feedUrl.protocol}//${feedUrl.host}/request_event/${entry.id}`;
  const body = _.prune(
    entry.public_body.short_name || entry.public_body.name,
    process.env.BODY_NAME_LENGTH,
    "…"
  );
  const title = entry.info_request.title;
  const user = _.prune(entry.user.name, process.env.USER_NAME_LENGTH, "…");

  const status = (entry.display_status || "").replace(/\.$/, "");

  // ignore some event types & bad display statuses
  if (ignoredEventTypes.includes(entry.event_type) || !status) {
    return callback();
  }

  const isRequest = entry.event_type === "sent";
  const text = _.prune(
    incoming
      ? `[${status}] ${body} replied about ${title}`
      : // special case for sent event_type
      isRequest
      ? `[Request] ${user} asked ${body} ${title}`
      : `[${status}] ${user} about ${title}`,
    textLength - 1,
    "…"
  ); // -1 for the ellipsis

  if (createdAt > considerPostsAfter) {
    if (createdAt > latest) {
      latest = createdAt;
    }

    const statusByteStart = text.indexOf("[");
    const statusByteEnd = text.indexOf("]") + 1;
    const facets = [
      {
        index: { byteStart: statusByteStart, byteEnd: statusByteEnd },
        features: [{ $type: "app.bsky.richtext.facet#link", uri: url }],
      },
    ];
    const bodySlug = entry.public_body?.url_name;
    if (isRequest && bodySlug) {
      const bodyByteStart = text.indexOf(body);
      const bodyByteEnd = bodyByteStart + body.length;
      const bodyUrl = `${feedUrl.protocol}//${feedUrl.host}/body/${bodySlug}`;
      facets.push({
        index: { byteStart: bodyByteStart, byteEnd: bodyByteEnd },
        features: [{ $type: "app.bsky.richtext.facet#link", uri: bodyUrl }],
      });
    }

    const rt = new RichText({
      facets,
      text,
    });
    const postRecord = {
      $type: "app.bsky.feed.post",
      text: rt.text,
      facets: rt.facets,
      createdAt: new Date().toISOString(),
    };
    if (willPostToBluesky) {
      try {
        await agent.post(postRecord);
        console.log(`Posted about entry #${entry.id} successfully`);
      } catch (err) {
        console.log(`Error posting to bluesky: ${err}`);
        callback();
      }
    } else {
      console.log(`
      ENTRY:
        ${JSON.stringify(entry, null, 2)}

      RECORD:
        ${JSON.stringify(postRecord, null, 2)}`);
      callback();
    }
  } else {
    console.log(`entry from before timestamp we're considering, discarding`);
    callback();
  }
}, 1);

workQueue.drain(() => {
  if (latest > considerPostsAfter) {
    considerPostsAfter = latest;
  }
  console.log(
    `Polling again in ${delay} minutes for events after ${humaniseStartDate()}`
  );
  setTimeout(poll, delay * 60 * 1000);
});

let errorCount = 0;
async function poll() {
  try {
    const url = `${process.env.FEED_URL}.json`;
    const response = await fetch(url);
    const entries = await response.json();

    if (Array.isArray(entries)) {
      const workItems = entries.filter((entry) => {
        const createdAt = moment(entry.created_at).valueOf();
        return createdAt > considerPostsAfter;
      });
      console.log(`Adding ${workItems.length} items to work queue`);
      workQueue.unshift(workItems);
    } else {
      throw new Error("Did not get an array of entries");
    }
    errorCount = 0;
  } catch (err) {
    console.log(
      `ERROR: ${err} Polling again in $ minutes for events after ${humaniseStartDate()}...`
    );
    setTimeout(poll, (delay + errorCount) * 60 * 1000);
    errorCount++;
  }
}

if (process.env.FEED_URL) {
  poll();
}
