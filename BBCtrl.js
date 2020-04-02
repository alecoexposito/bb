module.exports = (SerialPort, nmea, net, fs, Readline, scServer) => {
    class bbController {
        constructor() {

        }

        saveOfflineData(db, values) {
            console.log("saving data offline: ", values);
            db.run('insert into info_data(device_id, lat, lng, speed, created_at, updated_at, is_offline, orientation_plain) values(?, ?, ?, ?, ?, ?, ?, ?)', values, function(err) {
                if(err) {
                    return console.log(err.message);
                }

                // console.log('Row inserted with id: ', this.lastID);
            });

        }

        isJsonString(str) {
            try {
                JSON.parse(str);
            } catch (e) {
                return false;
            }
            return true;
        }

        run(options, client, db) {
            var _this = this;
            _this.tcpLock = false;
            /**
             * conectandome al puerto tcp 2947 para enviar las tramas a medida que lleguen
             */

            var tcpClient = new net.Socket();
            try {
                tcpClient.connect(2947, '127.0.0.1');
            } catch (e) {
                console.log("************************** ocurrio un error conectando al puerto tcp local ***************************************");
            }

            tcpClient.on("error", function() {
                if (_this.tcpLock === false) {
                    console.log("error conectandose al tcp, reconectando en 3 segundos");
                    _this.tcpLock = true;
                    setTimeout(function() {
                        console.log("reconectando ahora.....");
                        tcpClient.connect(2947, '127.0.0.1');
                        _this.tcpLock = false;
                    }, 3000);
                }
            });



            console.log("************* en el run de la bb *********************");
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
                setTimeout(function() {
                    portS1.open(function (err) {
                        if (err) {
                            var errorstr = "Error opening port: " + err.message;

                        } else {
                            console.log("PORT OPENED");
                        }
                    });

                }, 1000)
            });

            portS1.on('close', function () {
                setTimeout(function() {
                    portS1.open(function (err) {
                        if (err) {
                            var errorstr = "Error opening port: " + err.message;

                        } else {
                            console.log("PORT OPENED");
                        }
                    });

                }, 1000)
            });

            const parser = portS1.pipe(new Readline({delimiter: '\r\n'}));
            // parser.on('data', function(data){console.log("data en el parser: ", data);})
            parser.on("data", function (data) {
                // console.log("data en el puerto: ", data.toString());
                console.log("enviando los datos recibidos al tcp: ", data);
                tcpClient.write(data, function(err) {
                    if(err) {
                        console.log("error enviando al puerto tcp");
                    }
                });
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
                    client.write(buffer, function(err) {
                        if(err) {
                            console.log("error writing to socket, writing offline");
                            is_offline = 1;
                        } else {
                            // console.log("all ok");
                            is_offline = 0;
                        }
                        let values = [response.device_id, response.latitude, response.longitude, response.speed, moment().valueOf(), moment().valueOf(), is_offline, response.track];
                        self.saveOfflineData(db, values);
                    });

                    // console.log('wrote in client and offline');

                }
            });

            client.on('data', function(data) {
                if(self.isJsonString(data.toString())) {
                    let dataJson = JSON.parse(data.toString());
                    if(dataJson.type == "reply")
                        console.log("reply from tracker: ", data.toString());
                    else if (dataJson.type == "reply-offline") {
                        console.log("reply from tracker: ", data.toString());
                        let ids = dataJson.ids;
                        for (let i = 0; i < ids.length; i++) {
                            let params = [];
                            params.push(ids[i]);
                            db.run('update info_data set is_offline = 2 where is_offline = 1 and id = ?', params, function(err) {
                                if(err) {
                                    return console.log(err.message);
                                }
                            });
                        }
                    }
                }
            });
        }
    }

    return new bbController(SerialPort, nmea, net, fs, Readline, scServer);
};

