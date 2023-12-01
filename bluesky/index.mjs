import { config } from "dotenv";
import blue from "@atproto/api";
import { queue } from "async";
import fetch from "node-fetch";
import { parse } from "url";
import _ from "underscore.string";
import moment from "moment";

const { RichText, BskyAgent } = blue;
const startup = Date.now();
let considerPostsAfter = startup;
let latest = considerPostsAfter;

config();

const agent = new BskyAgent({ service: "https://bsky.social/" });
await agent.login({
  identifier: process.env.BLUESKY_BOT_EMAIL,
  password: process.env.BLUESKY_BOT_PASSWORD,
});

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
NODE_ENV: ${process.env.NODE_ENV}
`);

const humaniseStartDate = () => moment(considerPostsAfter).format("LLL");

const feedUrl = parse(process.env.FEED_URL);
// URL is t.co wrapped, short_url_length_https = 23, plus a space after the URL
const textLength = process.env.POST_LENGTH - 24;

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

  if (entry.event_type === "comment" || !status) {
    return callback();
  }

  const text = _.prune(
    incoming
      ? `[${status}] ${body} replied about ${title}`
      : `[${status}] ${user} about ${title}`,
    textLength - 1,
    "…"
  ); // -1 for the ellipsis

  if (createdAt > considerPostsAfter) {
    if (createdAt > latest) {
      latest = createdAt;
    }

    if (process.env.NODE_ENV === "production") {
      const byteStart = text.indexOf("[");
      const byteEnd = text.indexOf("]") + 1;
      const rt = new RichText({
        facets: [
          {
            index: { byteStart, byteEnd },
            features: [{ $type: "app.bsky.richtext.facet#link", uri: url }],
          },
        ],
        text,
      });
      const postRecord = {
        $type: "app.bsky.feed.post",
        text: rt.text,
        facets: rt.facets,
        createdAt: new Date().toISOString(),
      };
      try {
        await agent.post(postRecord);
      } catch (err) {
        console.log(err);
        callback();
      }
    } else {
      console.log(text);
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
      console.log(
        `Adding ${entries.length} feed items to the queue to be considered.`
      );
      workQueue.unshift(entries);
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
