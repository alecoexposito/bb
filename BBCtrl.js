module.exports = (SerialPort, nmea, net, fs, Readline, scServer) => {
    class bbController {
        constructor() {

        }

        saveOfflineData(db, values) {
            // console.log("saving data offline: ", values);
            db.run('insert into info_data(device_id, lat, lng, speed, created_at, updated_at, is_offline) values(?, ?, ?, ?, ?, ?, ?)', values, function(err) {
                if(err) {
                    return console.log(err.message);
                }

                // console.log('Row inserted with id: ', this.lastID);
            });

        }

        connect(options) {
            return new Promise((resolve) => {
                this.portS1 = new SerialPort(options.serialPort, { baudRate: options.baudRate, autoOpen: false, lock: false });
                this.parser = this.portS1.pipe(new Readline({delimiter: '\r\n'}));
                this.portS1.on('open', () => {
                    this.connected = true;
                    // this.setupParser();
                });
                this.portS1.on('close', () => {
                    this.connected = false;
                    setTimeout(this.reconnect.bind(this), 5000);
                });
                this.portS1.on('error', () => {
                    setTimeout(this.reconnect.bind(this), 5000);
                });

                this.portS1.open();

                resolve(this.parser);
            });
        }

        reconnect() {
            if (!this.connected) { this.portS1.open(); }
        }

        setupParser(client, db) {
            // const parser = this.portS1.pipe(new Readline({delimiter: '\r\n'}));
            var _this = this;
            var device_id = process.env.DEVICE_IMEI;
            this.parser.on("data", function (data) {
                // console.log("data en el puerto: ", data.toString());
                var moment = require('moment');
                let gprmc = nmea.parse(data.toString());
                // console.log("gprmc: ", gprmc);
                if (gprmc.valid == true && gprmc.type == 'RMC') {
                    let response = {
                        'device_id': device_id,
                        'latitude': gprmc.loc.geojson.coordinates[1],
                        'longitude': gprmc.loc.geojson.coordinates[0],
                        'speed': gprmc.speed.kmh,
                        'track': gprmc.track
                    };

                    let buffer = Buffer.from(JSON.stringify(response));
                    var is_offline = 0;
                    try {
                        client.write(buffer, function (err) {
                            if (err) {
                                console.log("error writing to socket, writing offline");
                                _this.reconnect();
                                is_offline = 1;
                            } else {
                                // console.log("all ok");
                                is_offline = 0;
                            }
                            let values = [response.device_id, response.latitude, response.longitude, response.speed, moment().valueOf(), moment().valueOf(), is_offline];
                            _this.saveOfflineData(db, values);
                        });
                    } catch (e) {
                        console.log("error writing to traker: ", e)
                        // _this.reconnect();
                    }

                    // console.log('wrote in client and offline');

                }
            });

        }

        run(options, client, db) {
            var self = this;

            let device_id = process.env.DEVICE_IMEI; // '353147044612671';
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
                portS1.open(function (err) {
                    if (err) {
                        var errorstr = "Error opening port: " + err.message;

                    } else {
                        console.log("PORT OPENED");
                    }
                });
            });

            portS1.on('close', function () {
                portS1.open(function (err) {
                    if (err) {
                        var errorstr = "Error opening port: " + err.message;

                    } else {
                        console.log("PORT OPENED");
                    }
                });
            });

            const parser = portS1.pipe(new Readline({delimiter: '\r\n'}));
            // parser.on('data', function(data){console.log("data en el parser: ", data);})
            parser.on("data", function (data) {
                // console.log("data en el puerto: ", data.toString());
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

            // this.connect(options).then(() => {
            //     this.setupParser(client, db);
            // });


        }
    }

    return new bbController(SerialPort, nmea, net, fs, Readline, scServer);
};

