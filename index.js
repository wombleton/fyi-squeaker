var async = require('async'),
    _ = require('underscore'),
    fs = require('fs'),
    properties = require('properties'),
    env,
    request = require('request'),
    url = require('url'),
    _s = require('underscore.string'),
    sprintf = require("sprintf-js").sprintf,
    feedUrl,
    moment = require('moment'),
    startup = Date.now(),
    latest = 0,
    twitter = require('twit'),
    twit,
    delay,
    queue;

try {
  env = fs.readFileSync('.env', 'utf8');
  _.extend(process.env, properties.parse(env));
} catch(e) {
  // do nothing. normal in production
}

twit = twitter({
  consumer_key: process.env.CONSUMER_KEY,
  consumer_secret: process.env.CONSUMER_SECRET,
  access_token: process.env.ACCESS_TOKEN,
  access_token_secret: process.env.ACCESS_SECRET
});

process.env.TWEET_LENGTH = process.env.TWEET_LENGTH || 140;
process.env.BODY_NAME_LENGTH = process.env.BODY_NAME_LENGTH || 30;
process.env.USER_NAME_LENGTH = process.env.USER_NAME_LENGTH || 30;

console.log('CONSUMER_KEY: '+process.env.CONSUMER_KEY);
console.log('CONSUMER_SECRET: '+(process.env.CONSUMER_SECRET != null));
console.log('ACCESS_TOKEN: '+process.env.ACCESS_TOKEN);
console.log('ACCESS_SECRET: '+(process.env.ACCESS_SECRET != null));
console.log('FEED_URL: '+process.env.FEED_URL);
console.log('DELAY: '+process.env.DELAY);
console.log('TWEET_LENGTH: '+process.env.TWEET_LENGTH);
console.log('BODY_NAME_LENGTH: '+process.env.BODY_NAME_LENGTH);
console.log('USER_NAME_LENGTH: '+process.env.USER_NAME_LENGTH);
console.log('NODE_ENV: '+process.env.NODE_ENV);

feedUrl = url.parse(process.env.FEED_URL);
// URL is t.co wrapped, short_url_length_https = 23, plus a space after the URL
textLength = process.env.TWEET_LENGTH - 24;

queue = async.queue(processEntry);
queue.drain = function() {
  if (latest > startup) {
    startup = latest;
  }
  console.log('polling again in %s minutes for events after %s ...', delay, moment(startup).format('LLL'));
  setTimeout(poll, delay * 60 * 1000);
};

function poll() {
  request({
    json: true,
    uri: process.env.FEED_URL + '.json'
  }, function(err, response, entries) {
    var $;

    delay = delay || process.env.DELAY || 5;

    if (_.isArray(entries)) {
      entries.reverse();
    } else {
      err = "JSON parse error.";
    }

    if (err) {
      console.log('ERROR: %s Polling again in %s minutes for events after %s ...', err, delay++, moment(startup).format('LLL'));
      setTimeout(poll, delay * 60 * 1000);
    } else {
      queue.push(entries);
    }
  });
}

function processEntry(entry, callback) {
  var incoming = !!entry.incoming_message_id,
      ts = moment(entry.created_at).valueOf(),
      url = feedUrl.protocol + '//' + feedUrl.host + '/request_event/' + entry.id,
      body = _s.prune(entry.public_body.short_name || entry.public_body.name, process.env.BODY_NAME_LENGTH, '…'),
      title = entry.info_request.title,
      user = _s.prune(entry.user.name, process.env.USER_NAME_LENGTH, '…'),
      status = (entry.display_status || '').replace(/\.$/, ''),
      line;

  if (entry.event_type === 'comment' || !status) {
    return callback();
  }

  if (incoming) {
    line = sprintf('[%s] %s replied about %s', status, body, title);
  } else {
    line = sprintf('[%s] %s about %s', status, user, title);
  }
  line = _s.prune(line, textLength-1, '…'); // -1 for the ellipsis
  line = sprintf('%s %s', url, line);

  if (ts > startup) {
    if (ts > latest) {
      latest = ts;
    }

    if (process.env.NODE_ENV === 'production') {
      twit.post('statuses/update', { status: line },
        function(err, data, response) {
          if(err) { console.error(err) };

          callback();
        });

    } else {
      console.log(line);
      callback();
    }
  } else {
    callback();
  }
}

if (process.env.FEED_URL) {
  poll();
}
