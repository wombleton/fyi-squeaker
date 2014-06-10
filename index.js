var async = require('async'),
    _ = require('underscore'),
    fs = require('fs'),
    properties = require('properties'),
    env,
    request = require('request'),
    url = require('url'),
    _s = require('underscore.string'),
    feedUrl,
    moment = require('moment'),
    startup = Date.now(),
    latest = 0,
    twitter = require('ntwitter'),
    twit,
    delay,
    queue;

twit = twitter({
  consumer_key: process.env.CONSUMER_KEY,
  consumer_secret: process.env.CONSUMER_SECRET,
  access_token_key: process.env.ACCESS_TOKEN,
  access_token_secret: process.env.ACCESS_SECRET
});

try {
  env = fs.readFileSync('.env', 'utf8');
  _.extend(process.env, properties.parse(env));
} catch(e) {
  // do nothing. normal in production
}

feedUrl = url.parse(process.env.FEED_URL);

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
      body = _s.prune(entry.public_body.short_name || entry.public_body.name, 30, ''),
      title = entry.info_request.title,
      user = _s.prune(entry.user.name, 30, ''),
      status = (entry.display_status || '').replace(/\.$/, ''),
      line;

  if (entry.event_type === 'comment' || !status) {
    return callback();
  }

  if (incoming) {
    line = _s.sprintf('%s [%s] %s replied about %s', url, status, body, title);
  } else {
    line = _s.sprintf('%s [%s] %s about %s', url, status, user, title);
  }

  if (ts > startup) {
    if (ts > latest) {
      latest = ts;
    }
    if (process.env.NODE_ENV === 'production') {
      twit.updateStatus(_s.prune(line, 140), callback);
    } else {
      console.log(_s.prune(line, 140));
      callback();
    }
  } else {
    callback();
  }
}

if (process.env.FEED_URL) {
  poll();
}
