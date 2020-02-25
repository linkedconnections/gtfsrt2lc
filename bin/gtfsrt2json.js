#!/usr/bin/env node

const fs = require('fs');
const Gtfsrt2LC = require('../lib/Gtfsrt2LC');
var program = require('commander');

console.error("GTFS-RT to JSON converter use --help to discover how to use it");

program
    .option('-r --real-time <realTime>', 'URL/path to gtfs-rt feed')
    .option('-H --headers <headers>', 'Extra HTTP headers for requesting the gtfs files. E.g., {\\"api-Key\\":\\"someApiKey\\"}')
    .parse(process.argv);

if (!program.realTime) {
    console.error('Please provide a url or a path to a GTFS-RT feed');
    process.exit();
}

// Set HTTP custom headers, e.g., API keys
var headers = {};
if (program.headers) {
    try {
        headers = JSON.parse(program.headers);
    } catch (err) {
        console.error('Please provide a valid JSON string for the extra HTTP headers');
        process.exit();
    }
}

async function parse() {
    let gtfsrt2lc = new Gtfsrt2LC({ path: program.realTime, headers: headers });
    console.log(JSON.stringify(await gtfsrt2lc.parse2Json()));
}

parse();