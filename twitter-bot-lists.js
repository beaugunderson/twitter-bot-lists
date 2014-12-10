'use strict';

var async = require('async');
var botUtilities = require('bot-utilities');
var debug = require('debug')('twitter-bot-lists');
var expandUrl = require('expand-url');
var MemoizeCache = require('level-cache-tools').MemoizeCache;
var path = require('path');
var Twit = require('twit');
var _ = require('lodash');

var URL_RE = /(\b(https?|ftp):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/gim;

var T = new Twit(botUtilities.getTwitterAuthFromEnv());

var botLists = [
  '01101O10/lists/bot-list',
  'beaugunderson/lists/image-input-bots',
  'beaugunderson/lists/my-bots',
  'BooDooPerson/lists/bots',
  'botALLY/lists/omnibots',
  'brownpau/lists/bots',
  'ckolderup/lists/the-fall-of-humanity',
  'dbaker_h/lists/glitch-bots',
  'dphiffer/lists/impractical',
  'Gangles/lists/twitter-bots',
  'HarryGiles/lists/everyword-orgy',
  'inky/lists/bots',
  'looocas/lists/my-bot-garden',
  'mambocab/lists/great-bots',
  'mcmoots/lists/one-word-wonders',
  'negatendo/lists/bot-net',
  'nickfletchr/lists/image-bots',
  'RobotDramatico/lists/infinitos-monos',
  'sleepgoth/lists/bots',
  'thricedotted/lists/butt-bots',
  'thricedotted/lists/thricedotted-bottes',
  'tinysubversions/lists/darius-kazemi-s-bots',
  'tullyhansen/lists/bots'
];

function cachePath(name) {
  return path.join(path.dirname(require.main.filename), 'caches', name);
}

var members = new MemoizeCache(cachePath('list-members'), function (list, cb) {
  list = list.split('/lists/');

  T.get('lists/members', {
    owner_screen_name: list[0],
    slug: list[1],
    count: 5000,
    skip_status: true
  }, function (err, data) {
    // Discard the third argument to this callback
    cb(err, data);
  });
});

var RE_USERNAME = /(?:^|[^A-Za-z0-9])(@\w{1,15})\b/g;
var RE_HASHTAG = /(?:^|[^A-Za-z0-9])(#[A-Za-z0-9_]+)\b/g;

function matches(re, text) {
  var results = [];
  var match;

  while ((match = re.exec(text)) !== null) {
    results.push(match[1]);
  }

  return results;
}

function botMatches(re, bot) {
  return _([bot.description, bot.location])
    .map(_.partial(matches, re))
    .flatten()
    .uniq()
    .value();
}

// Get expanded URLs from the entities' description and url attributes
function urls(entities) {
  return _(entities)
    .map(function (source) {
      return _.pluck(source.urls, 'expanded_url');
    })
    .compact()
    .flatten()
    .uniq()
    .value();
}

function mainUrl(entities) {
  if (entities.url && entities.url.urls.length === 1) {
    return entities.url.urls[0].expanded_url;
  }

  return '';
}

function processBot(bot, cb) {
  var foundUrls = bot.description.match(URL_RE) || [];

  async.map(foundUrls, expandUrl.expand, function (ignoredError, expandedUrls) {
    if (expandedUrls) {
      debug('foundUrls', foundUrls);
      debug('expandedUrls', expandedUrls);
    }

    expandedUrls.forEach(function (url, i) {
      bot.description = bot.description.replace(foundUrls[i], url);
    });

    cb(null, {
      id: bot.id_str,
      name: bot.name,
      screenName: bot.screen_name,
      avatar: bot.profile_image_url_https,
      description: bot.description,
      mainUrl: mainUrl(bot.entities),
      urls: urls(bot.entities),
      usernames: botMatches(RE_USERNAME, bot),
      hashtags: botMatches(RE_HASHTAG, bot),
      location: bot.location,
      createdAt: new Date(bot.created_at),
      statuses: bot.statuses_count,
      listed: bot.listed_count,
      followers: bot.followers_count
    });
  });
}

module.exports = function (cb) {
  async.map(botLists, function (list, cbMap) {
    debug('getting', list);

    members(list, function (err, data) {
      if (err) {
        return cbMap(err);
      }

      async.map(data.users, processBot, cbMap);
    });
  }, function (err, bots) {
    if (err) {
      return cb(err);
    }

    bots = _(bots)
      .flatten()
      .uniq(function (bot) {
        return bot.screenName;
      })
      .value();

    members.db.close(function () {
      cb(null, bots);
    });
  });
};
