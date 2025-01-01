#!/usr/bin/env node

import fs from 'fs';
import { GtfsIndex } from '../lib/GtfsIndex.js';
import { Gtfsrt2LC } from '../lib/Gtfsrt2LC.js';
import { Level } from 'level';
import { program } from 'commander';

program
    .option('-r --real-time <realTime>', 'URL/path to gtfs-rt feed')
    .option('-s --static <static>', 'URL/path to static gtfs feed')
    .option('-u --uris-template <urisTemplate>', 'Templates for Linked Connection URIs following the RFC 6570 specification')
    .option('-H --headers <headers>', 'Extra HTTP headers for requesting the gtfs files. E.g., {\\"api-Key\\":\\"someApiKey\\"}')
    .option('-f --format <format>', 'Output serialization format. Choose from json, jsonld, turtle, ntriples and csv. (Default: json)')
    .option('-S --store <store>', 'Store type: LevelStore (uses your hard disk to avoid that you run out of RAM) or MemStore (default)')
    .option('-g --grep', 'Use grep to index only the trips present in the GTFS-RT. Useful for dealing with big GTFS feeds in memory.')
    .option('-d --deduce', 'Create additional indexes to identify Trips on GTFS-RT feeds that do not provide a trip_id')
    .option('-h --history <history>', 'Path to historic Connection LevelStore for differential updates')
    .parse(process.argv);

if (!program.opts().realTime) {
    console.error('Please provide a url or a path to a GTFS-RT feed');
    console.error("GTFS-RT to linked connections converter use --help to discover how to use it");
    process.exit();
}

if (!program.opts().static) {
    console.error('Please provide a url or a path to a GTFS feed');
    console.error("GTFS-RT to linked connections converter use --help to discover how to use it");
    process.exit();
}

if (!program.opts().store) {
    program.opts().store = 'MemStore';
}

// Load URIs template
let template = null;
try {
    if (program.opts().urisTemplate) {
        template = JSON.parse(fs.readFileSync(program.opts().urisTemplate, 'utf8'));
    }
} catch (err) {
    console.error('Please provide a valid path to a template file');
    console.error("GTFS-RT to linked connections converter use --help to discover how to use it");
    process.exit();
}
// Get resulting data format
const format = program.opts().format || 'json';
// Set HTTP custom headers, e.g., API keys
let headers = {};
if (program.opts().headers) {
    try {
        headers = JSON.parse(program.opts().headers);
    } catch (err) {
        console.error(err);
        console.error('Please provide a valid JSON string for the extra HTTP headers');
        console.error("GTFS-RT to linked connections converter use --help to discover how to use it");
        process.exit();
    }
}

// Load historic connections store (if any)
let historyDB = null;
if(program.opts().history) {
    historyDB = new Level(program.opts().history, { valueEncoding: 'json' });
}

let t0 = new Date();
const gtfsrt2lc = new Gtfsrt2LC({ path: program.opts().realTime, uris: template, headers: headers });
const gtfsIndexer = new GtfsIndex({ path: program.opts().static, headers: headers });

async function processUpdate(store, grep, deduce) {
    console.error("Converting the GTFS-RT feed to Linked Connections");
    try {
        let trips = null;

        if (grep) {
            // Get list of updated trips
            trips = await gtfsrt2lc.getUpdatedTrips();
        }
        // Get GTFS indexes (stops.txt, routes.txt, trips.txt, stop_times.txt)
        console.error("Creating the GTFS indexes needed for the conversion");
        const indexes = await gtfsIndexer.getIndexes({ store: store, trips: trips, deduce: deduce });
        indexes.historyDB = historyDB;
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

processUpdate(program.opts().store, program.opts().grep, program.opts().deduce);