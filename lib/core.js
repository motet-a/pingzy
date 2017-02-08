'use strict'

const _ = require('lodash')
const events = require('events')
const fs = require('fs')
const request = require('request')
const shell = require('shelljs')
const util = require('util')

const logger = require('./logger')

function Core() {
    events.EventEmitter.call(this)

    /* Set up the default options. */
    this.options = {
        tmp: '.tmp',
        logFile: null,
        verbose: false,
        urls: [],
    }
}

util.inherits(Core, events.EventEmitter)

Core.prototype.start = function (options, callback) {
    options = options || {}
    if (_.isFunction(options)) {
        callback = options
        options = {}
    }

    this.options = _.defaults(options, this.options)

    callback = callback || (() => {})

    /* Create tmp dir if necessary. */
    if (!fs.existsSync(this.options.tmp)) {
        shell.mkdir('-p', this.options.tmp)
    }

    /* Log to a file if necessary. */
    if (this.options.logFile) {
        logger.setLogFile(this.options.logFile)
    }

    /* Set log level if necessary. */
    if (this.options.verbose) {
        logger.setLevel('verbose')
        logger.info('Log level set to verbose.')
    }

    const postToSlack = data => {
        if (!this.options.slackUrl) {
            return
        }

        request({
            uri: this.options.slackUrl,
            method: 'POST',
            body: JSON.stringify(data)
        }, (err, response) => {
            if (err || response.statusCode !== 200) {
                err = err || new Error('Unable to post to slack.\n' + response.body)
                logger.error(err.stack)
            }
        })
    }

    const websites = this.options.urls.map(url => {
        return {
            url,
            prettyUrl: url.substr(url.indexOf('/') + 2),
            isDown: false,
            lastCheckWasDown: false,
            wentDownAt: null,
            downtimeCount: 0
        }
    })

    const checkWebsites = () => {
        websites.forEach(website => {
            logger.info('Checking ' + website.url)
            logger.info(website)

            request({
                uri: website.url,
                method: 'GET',
                timeout: 10000,
                headers: {
                    'User-Agent': 'Pingzy'
                }
            }, (err, response) => {
                if (err) {
                    logger.error('Error while checking ' + website.url +
                        '\n' + err.stack)
                }

                const fifteenMinutes = 1000 * 60 * 15
                if (err || response.statusCode !== 200) {
                    if (!website.lastCheckWasDown) {
                        logger.info('Website ' + website.url + ' seems to be down. Waiting for next check.')
                        website.lastCheckWasDown = true
                    } else if (!website.isDown) {
                        logger.warn('Website went down: ' + website.url)

                        website.isDown = true
                        website.wentDownAt = new Date()
                        website.downtimeCount++

                        postToSlack({
                            fallback: 'Website <' + website.url + '|' + website.prettyUrl + '> just went down at ' + website.wentDownAt,
                            color: 'danger',
                            fields: [{
                                value: 'Website <' + website.url + '|' + website.prettyUrl + '> just went down at ' + website.wentDownAt
                            }],
                            channel: this.options.slackChannel,
                            username: 'Pingzy',
                            icon_emoji: ':thumbsdown:'
                        })
                    } else if ((Date.now() - website.wentDownAt.getTime()) > fifteenMinutes) {
                        logger.warn('Website is still down: ' + website.url)

                        postToSlack({
                            fallback: 'Website <' + website.url + '|' + website.prettyUrl + '> is still down.',
                            color: 'danger',
                            fields: [{
                                value: 'Website <' + website.url + '|' + website.prettyUrl + '> is still down.'
                            }],
                            channel: this.options.slackChannel,
                            username: 'Pingzy',
                            icon_emoji: ':thumbsdown:'
                        })
                    }
                } else if (website.isDown) {
                    logger.warn('Website is back up: ' + website.url)

                    website.isDown = false
                    website.lastCheckWasDown = false
                    postToSlack({
                        fallback: 'Website <' + website.url + '|' + website.prettyUrl + '> went back online. Good job!',
                        color: 'good',
                        fields: [{
                            value: 'Website <' + website.url + '|' + website.prettyUrl + '> went back online. Good job!',
                        }],
                        channel: this.options.slackChannel,
                        username: 'Pingzy',
                        icon_emoji: ':thumbsup:'
                    })
                }
            })
        })
    }

    const stringUrls = this.options.urls
        .map(url => '<' + url + '|' + url + '> ')
        .join(', ')

    const sendSummaryToSlack = () => {
        logger.info('Sending summary.')

        const fields = websites.map(website => {
            const value = website.isDown ? (
                'Site is *down* since ' + website.wentDownAt
            ) : (
                'Site is currently up and has been down ' +
                website.downtimeCount + ' times.'
            )

            return {
                title: website.url,
                value: value,
                short: false
            }
        })

        postToSlack({
            fallback: 'Hi there! Still monitoring urls: ' + stringUrls,
            color: 'good',
            pretext: 'Daily summary:',
            fields: fields,
            channel: this.options.slackChannel,
            username: 'Pingzy',
            icon_emoji: ':thumbsup:'
        })
    }

    /* Bootstrap. */
    setInterval(checkWebsites, 1000 * 60 * this.options.interval)
    setInterval(sendSummaryToSlack, 1000 * 60 * 60 * 24)

    postToSlack({
        text: 'Starting monitoring urls: ' + stringUrls,
        channel: this.options.slackChannel,
        username: 'Pingzy',
        icon_emoji: ':thumbsup:'
    })

    checkWebsites()
    callback()
}

module.exports = new Core()
