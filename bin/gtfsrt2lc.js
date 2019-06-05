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
    .option('-f --format <format>', 'Output serialization format. Choose from json, jsonld, turtle, ntriples and csv. (Default: json)')
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

// Load URIs template
var template = null;
try {
    template = JSON.parse(fs.readFileSync(program.urisTemplate, 'utf8'));
} catch (err) {
    console.error('Please provide a valid path to a template file');
    process.exit();
}

// Get format
var format = program.format || 'json';

// Get static GTFS indexes
var gtfs = new GtfsIndex(program.static);
gtfs.getIndexes().then(async ([routes, trips, stops, stop_times]) => {
    // Proceed to parse GTFS-RT
    let gtfsrt2lc = new Gtfsrt2LC(program.realTime, routes, trips, stops, stop_times, template);
    let rtlc = await gtfsrt2lc.parse(format, false);
    // Output data
    rtlc.pipe(process.stdout);
    rtlc.on('end', () => {
        process.exit();
    });
}).catch(err => {
    console.error(err);
    process.exit();
});
