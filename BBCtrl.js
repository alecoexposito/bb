module.exports = (SerialPort, nmea, net, fs, Readline, scServer) => {
    class bbController {
        constructor() {

        }

        saveOfflineData(db, values) {
            console.log("saving data offline: ", values);
            db.run('insert into info_data(device_id, lat, lng, speed, created_at, updated_at, is_offline) values(?, ?, ?, ?, ?, ?, ?)', values, function(err) {
                if(err) {
                    return console.log(console.log(err.message));
                }

                console.log('Row inserted with id: ', this.lastID);
            });

        }

        run(options, client, db) {
            var self = this;

            /*let content = fs.readFileSync('/proc/cpuinfo', 'utf8');
            let cont_array = content.split("\n");
            let serial_line = cont_array[cont_array.length-2];
            let serial = serial_line.split(":");*/
            let device_id = '353147044612671';
            let portS1 = new SerialPort(options.serialPort, {baudRate: options.baudRate, autoOpen: false, lock: false});
            portS1.open(function (err) {
                if (err) {
                    var errorstr = "Error opening port: " + err.message;

                } else {
                    console.log("PORT OPENED");
                }
            });

            portS1.on('error', function (err) {
                console.log('Error en el puerto: ', err.message);
            });


            const parser = portS1.pipe(new Readline({delimiter: '\r\n'}));
            // parser.on('data', function(data){console.log("data en el parser: ", data);})
            parser.on("data", function (data) {
                var moment = require('moment');
                let gprmc = nmea.parse(data.toString());
                // console.log("gprmc: ", gprmc);
                if (gprmc.valid == true && gprmc.type == 'RMC') {
                    let response = {
                        'device_id': device_id,
                        'latitude': gprmc.loc.geojson.coordinates[1],
                        'longitude': gprmc.loc.geojson.coordinates[0],
                        'speed': gprmc.speed.kmh
                    };
                    let buffer = Buffer.from(JSON.stringify(response));
                    var is_offline = 0;
                    client.write(buffer, function(err) {
                        if(err) {
                            console.log("error writing to socket, writing offline");
                            is_offline = 1;
                        } else {
                            console.log("all ok");
                            is_offline = 0;
                        }
                        let values = [response.device_id, response.latitude, response.longitude, response.speed, moment().valueOf(), moment().valueOf(), is_offline];
                        self.saveOfflineData(db, values);
                    });

                    console.log('wrote in client and offline');

                }
            });

            // parser.on("stream_channel", function (data) {
            //     console.log("stream channel: ", data);
            // });



        }
    }

    return new bbController(SerialPort, nmea, net, fs, Readline, scServer);
};

