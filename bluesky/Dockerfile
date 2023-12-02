FROM node:21.3-alpine
MAINTAINER Oliver Lineham <requests@fyi.org.nz>

RUN mkdir /opt/alaveteli-squeaker
WORKDIR /opt/alaveteli-squeaker

ADD package*.json /opt/alaveteli-squeaker/
RUN npm install
ADD . /opt/alaveteli-squeaker

CMD ["node", "/opt/alaveteli-squeaker/index.mjs"]
