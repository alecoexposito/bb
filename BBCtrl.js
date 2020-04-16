module.exports = (SerialPort, nmea, net, fs, Readline, scServer) => {
    class bbController {
        constructor() {

        }

        sendToServer(client, info, db, data) {
            let buffer = Buffer.from(JSON.stringify(data));
            client.write(buffer, function(err) {
                if(err) {
                    console.log("setting offline local info with id: ", data.localId);
                    db.run('update info_data set is_offline = 1 where id = ?', [data.localId], function(err) {
                        if(err) {
                            console.log("error seteando offline id: ", data.localId);
                            return;
                        }
                    });
                }
            });

        }

        saveOfflineData(db, values, client, response) {
            const self = this;
            console.log("saving data offline: ", values);
            db.run('insert into info_data(device_id, lat, lng, speed, created_at, updated_at, is_offline, orientation_plain) values(?, ?, ?, ?, ?, ?, ?, ?)', values, function(err) {
                if(err) {
                    return console.log(err.message);
                }
                console.log('Row inserted with id: ', this.lastID);
                response.localId = this.lastID;
                self.sendToServer(client, values, db, response);
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

            console.log("************* en el run de la bb *********************");
            var self = this;

            let device_id = process.env.DEVICE_IMEI; // '353147044612671';
            let portS1 = new SerialPort(options.serialPort, {baudRate: options.baudRate, autoOpen: true, lock: false});
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
            var lastGpsMilliseconds = 0;
            parser.on("data", function (data) {
                // console.log("data en el puerto: ", data.toString());
                var moment = require('moment');
                let gprmc = nmea.parse(data.toString());
                // console.log("gprmc: ", gprmc);
                if (gprmc.valid == true && gprmc.type == 'RMC') {
                    console.log("FECHA: ", gprmc.datetime);
                    let gpsMilliseconds = moment(gprmc.datetime).valueOf();
                    console.log("MILLISECONDS: ", gpsMilliseconds);
                    let difference = gpsMilliseconds - lastGpsMilliseconds;

                    if (difference < 7000) {
                        console.log("NO TOCA TODAVIA");
                        return;
                    }
                    lastGpsMilliseconds = gpsMilliseconds;

                    let response = {
                        'device_id': device_id,
                        'latitude': gprmc.loc.geojson.coordinates[1],
                        'longitude': gprmc.loc.geojson.coordinates[0],
                        'speed': gprmc.speed.kmh,
                        'track': gprmc.track,
                        'createdAt': moment(gpsMilliseconds).format("YYYY-MM-DD HH:mm:ss"),
                        'updatedAt': moment(gpsMilliseconds).format("YYYY-MM-DD HH:mm:ss")
                    };
                    var is_offline = 3;
                    let values = [response.device_id, response.latitude, response.longitude, response.speed, gpsMilliseconds, gpsMilliseconds, is_offline, response.track];
                    self.saveOfflineData(db, values, client, response);
                }
            });

            client.on('data', function(data) {
                console.log("string data: ", data);
                let dataJson = JSON.parse(data.toString());
                console.log("data: ", dataJson);
                if(self.isJsonString(data.toString())) {
                    if(dataJson.type == "reply")
                        self.manageRegularConfirmation(dataJson, db);
                    else if (dataJson.type == "reply-offline") {
                        self.manageOfflineConfirmation(dataJson, db);
                    }
                }
            });
        }
        manageOfflineConfirmation(dataJson, db) {
            console.log("reply from tracker: ", dataJson);
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
        manageRegularConfirmation(dataJson, db) {
            console.log("reply from tracker: ", data.toString());
            let id = dataJson.localId;
            db.run('update info_data set is_offline = 0 where is_offline = 3 and id = ?', [id], function(err) {
                if(err) {
                    return console.log(err.message);
                }
            });


        }
    }

    return new bbController(SerialPort, nmea, net, fs, Readline, scServer);
};

