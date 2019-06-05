const fs = require('fs');
const GtfsIndex = require('./GtfsIndex');
const Gtfsrt2LC = require('./Gtfsrt2LC');

// Get static GTFS indexes
var gtfs = new GtfsIndex('https://sncb-opendata.hafas.de/gtfs/static/c21ac6758dd25af84cca5b707f3cb3de');
var template = JSON.parse(fs.readFileSync('./uris_template.json', 'utf8'));

gtfs.getIndexes().then(async ([routes, trips, stops, stop_times]) => {

    let liveFeed = 'https://sncb-opendata.hafas.de/gtfs/realtime/c21ac6758dd25af84cca5b707f3cb3de';
    let interval = setInterval(() => {
        // Proceed to parse GTFS-RT
        let gtfsrt2lc = new Gtfsrt2LC(liveFeed, routes, trips, stops, stop_times, template);
        gtfsrt2lc.parse('json', true).then(rtlc => {
            let cancelled = false;

            rtlc.on('data', connection => {
                if (connection['@type'] === 'CancelledConnection') {
                    cancelled = true;
                    console.log(connection);
                }
            }).on('end', () => {
                if (cancelled) {
                    console.log(new Date().toISOString() + ' -- Cancellation found!!!!');
                    clearInterval(interval);
                } else {
                    console.log(new Date().toISOString() + ' -- No cancellations....yet');
                }
            });
        });
    }, 30000);

}).catch(err => {
    console.error(err);
    process.exit();
});

