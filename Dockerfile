FROM node:7.5.0-alpine

RUN mkdir -p /usr/src/app
WORKDIR /usr/src/app

ENV NODE_ENV production
COPY package.json ./
RUN npm install && npm cache clean
COPY . .

CMD ./cli.js \
    --urls $URLS \
    --slack-domain $SLACK_DOMAIN \
    --slack-url $SLACK_URL \
    --slack-channel $SLACK_CHANNEL
