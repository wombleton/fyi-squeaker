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
    twitter = require('ntwitter'),
    twit,
    delay;

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

function poll() {
    var latest = startup;

    request({
        uri: process.env.FEED_URL + '.json'
    }, function(err, response, body) {
        var $,
            entries;

        if (err) {
            console.log('polling again in ' + delay++ + ' minutes for events after ' + startup + ' ...');
            setTimeout(poll, delay * 60 * 1000);
        } else {
            entries = JSON.parse(body);
            async.each(entries, function(entry, callback) {
                var incoming = !!entry.incoming_message_id,
                    ts = moment(entry.created_at).valueOf(),
                    url = feedUrl.protocol + '//' + feedUrl.host + '/request_event/' + entry.id,
                    body = _s.prune(entry.public_body.short_name || entry.public_body.name, 30, ''),
                    title = _s.prune(entry.info_request.title, 60, ''),
                    user = _s.prune(entry.user.name, 30, ''),
                    status = (entry.display_status || '').replace(/\.$/, ''),
                    line;

                if (entry.event_type === 'comment' || !status) {
                    return callback();
                }
                if (incoming) {
                    line = url + ' [' + status + '] ' + body + ' replied about ' + title;
                } else {
                    line = url + ' [' + status + '] ' + user + ' about ' + title;
                }

                if (ts > startup) {
                    latest = ts;
                    twit.updateStatus(line.substring(0, 140), callback);
                } else {
                    callback();
                }
            }, function(err) {
                delay = delay || process.env.DELAY || 5;

                if (err) {
                    delay++;
                    console.log(err);
                } else {
                    startup = latest;
                    delay = process.env.DELAY || 5;
                }

                console.log('polling again in ' + delay + ' minutes for events after ' + startup + ' ...');
                setTimeout(poll, delay * 60 * 1000);
            });
        }
    });
}

if (process.env.FEED_URL) {
    poll();
}
