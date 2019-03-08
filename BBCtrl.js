module.exports = (SerialPort, nmea, net, fs, Readline, scServer, sqlite3) => {
    class bbController {
        constructor() {
            this.db = new sqlite3.Database('/home/zurikato/.db/bb.sqlite', sqlite3.OPEN_READWRITE, (err) => {
                if(err) {
                    console.log("error openning the sqlite database");
                }
                console.log('connected to the sqlite database');
            });

        }

        saveOfflineData() {
            var db = this.db;


        }

        run(options) {

            /*let content = fs.readFileSync('/proc/cpuinfo', 'utf8');
            let cont_array = content.split("\n");
            let serial_line = cont_array[cont_array.length-2];
            let serial = serial_line.split(":");*/
            let device_id = 'BBP23';
            let portS1 = new SerialPort(options.serialPort, {baudRate: options.baudRate, autoOpen: false, lock: false});
            portS1.open(function (err) {
                if (err) {
                    var errorstr = "Error opening port: " + err.message;

                } else {
                    console.log("PORT OPENED");
                }
            });

            portS1.on('error', function (err) {
                console.log('Error: ', err.message);
            });
            const parser = portS1.pipe(new Readline({delimiter: '\r\n'}));
            //parser.on('data', function(data){console.log(data);})
            var client = new net.Socket();
            client.on('error', function (err) {
                console.log('OCURRIO EL ERROR');
                console.log(err);
            });
            client.connect(options.port, options.ipAddress, function () {

                parser.on("stream_channel", function (data) {
                    console.log("stream channel: ", data);
                });


                parser.on("data", function (data) {
                    // console.log(data);
                    let gprmc = nmea.parse(data.toString());
                    if (gprmc.valid == true && gprmc.type == 'RMC') {
                        let response = {
                            'device_id': device_id,
                            'latitude': gprmc.loc.geojson.coordinates[1],
                            'longitude': gprmc.loc.geojson.coordinates[0],
                            'speed': gprmc.speed.kmh
                        };
                        let buffer = Buffer.from(JSON.stringify(response));
                        if (client.writable) {
                            client.write(buffer);
                            console.log('wrote in client');
                        } else {
                            console.log('client not writable');
                            //----------
                            client = new net.Socket();
                            client.on('error', function (err) {
                                console.log(err)
                            });
                            client.connect(options.port, options.ipAddress, function () {
                                parser.on("data", function (data) {
                                    // console.log(data);
                                    let gprmc = nmea.parse(data.toString());
                                    if (gprmc.valid == true && gprmc.type == 'RMC') {
                                        let response = {
                                            'device_id': device_id,
                                            'latitude': gprmc.loc.geojson.coordinates[1],
                                            'longitude': gprmc.loc.geojson.coordinates[0],
                                            'speed': gprmc.speed.kmh
                                        };
                                        let buffer = Buffer.from(JSON.stringify(response));
                                        if (client.writable) {
                                            client.write(buffer);
                                            console.log('writing in client again');
                                        } else {
                                            console.log('client is still not writable not writable');
                                            console.log('destroying client for good');
                                            client.destroy();
                                            client.unref();
                                        }
                                    }
                                });

                            });

                            //-----------

                        }
                    }
                });

            });

        }
    }

    return new bbController(SerialPort, nmea, net, fs, Readline, scServer);
};

