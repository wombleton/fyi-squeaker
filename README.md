fyi-squeaker
============

Polls an Alaveteli instance looking for events to tweet about. Only tweets if it finds events timestamped *after* it has started up; it may well miss some.

It is intended to run on a heroku instance. See .env-example for example configuration. The keys are for twitter; the delay is minutes between each poll.
