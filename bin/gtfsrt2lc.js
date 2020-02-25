#!/usr/bin/env node

const fs = require('fs');
const GtfsIndex = require('../lib/GtfsIndex');
const Gtfsrt2LC = require('../lib/Gtfsrt2LC');
var program = require('commander');

console.error("GTFS-RT to linked connections converter use --help to discover how to use it");

program
    .option('-r --real-time <realTime>', 'URL/path to gtfs-rt feed')
    .option('-s --static <static>', 'URL/path to static gtfs feed')
    .option('-u --uris-template <template>', 'Templates for Linked Connection URIs following the RFC 6570 specification')
    .option('-H --headers <headers>', 'Extra HTTP headers for requesting the gtfs files. E.g., {\\"api-Key\\":\\"someApiKey\\"}')
    .option('-f --format <format>', 'Output serialization format. Choose from json, jsonld, turtle, ntriples and csv. (Default: json)')
    .option('-S --store <store>', 'Store type: LevelStore (uses your harddisk to avoid that you run out of RAM) or MemStore (default)')
    .option('-g --grep', 'Use grep to index only the trips present in the GTFS-RT. Useful for dealing with big GTFS feeds in memory.')
    .option('-d --deduce', 'Create additional indexes to identify Trips on GTFS-RT feeds that do not provide a trip_id')
    .parse(process.argv);

if (!program.realTime) {
    console.error('Please provide a url or a path to a GTFS-RT feed');
    process.exit();
}

if (!program.static) {
    console.error('Please provide a url or a path to a GTFS feed');
    process.exit();
}

if (!program.urisTemplate) {
    console.error('Please provide path to a template file');
    process.exit();
}

if (!program.store) {
    program.store = 'MemStore';
}

// Load URIs template
var template = null;
try {
    template = JSON.parse(fs.readFileSync(program.urisTemplate, 'utf8'));
} catch (err) {
    console.error('Please provide a valid path to a template file');
    process.exit();
}
// Get resulting data format
var format = program.format || 'json';
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

var t0 = new Date();
var gtfsrt2lc = new Gtfsrt2LC({ path: program.realTime, uris: template, headers: headers });
var gtfsIndexer = new GtfsIndex({ path: program.static, headers: headers });

async function processUpdate(store, grep, deduce) {
    try {
        let trips = null;

        if (grep) {
            // Get list of updated trips
            trips = await gtfsrt2lc.getUpdatedTrips();
        }
        // Get GTFS indexes (stops.txt, routes.txt, trips.txt, stop_times.txt)
        let indexes = await gtfsIndexer.getIndexes({ store: store, trips: trips, deduce: deduce });
        console.error(`GTFS indexing process took ${new Date().getTime() - t0.getTime()} ms`);
        t0 = new Date();
        gtfsrt2lc.setIndexes(indexes);
        // Create stream of updated Linked Connections
        let rtlc = await gtfsrt2lc.parse({ format: format, objectMode: false });
        // Output data
        rtlc.pipe(process.stdout);
        rtlc.on('end', () => {
            console.error(`Linked Connections conversion process took ${new Date().getTime() - t0.getTime()} ms`);
            process.exit();
        });
    } catch (err) {
        console.error(err);
    }
}

processUpdate(program.store, program.grep, program.deduce);