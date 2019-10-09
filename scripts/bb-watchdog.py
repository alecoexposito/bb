import netifaces
import os
import time
import logging
import serial
import daemon
import sys

def is_interface_up(interface):
    addr = netifaces.interfaces()
    return interface in addr

def start_modem():
    try:
        os.system("pppd call quectel-ppp &")
    except:
        print("ocurrio un error ejecutando el comando")
        logging.error("Exception occurred", exc_info=True)
        pass

def restart_modem():
    try:
        with serial.serial_for_url('/dev/ttyUSB2', 115200, timeout=2) as s:
            logging.info("comando a correr: AT+CFUN=0")
            s.write('AT+CFUN=0\r\n')
            line = s.readline()
            logging.info(line)
            line = s.readline()
            logging.info(line)
            line = s.readline()
            logging.info(line)
            line = s.readline()
            logging.info(line)

            s.write('AT+CFUN=1,1\r\n')
            line = s.readline()
            logging.info(line)
            line = s.readline()
            logging.info(line)
            line = s.readline()
            logging.info(line)
            line = s.readline()
            logging.info(line)

            s.write('AT+QSIMSTAT=1\r\n')
            line = s.readline()
            logging.info(line)
            line = s.readline()
            logging.info(line)
            line = s.readline()
            logging.info(line)
            line = s.readline()
            logging.info(line)

    except:
        print("ocurrio un error reiniciando modem")
        logging.error("Exception occurred restarting modem", exc_info=True)
        pass


def do_main(interface):
    print('test')
    counter1 = 0
    while True:
        logging.basicConfig(format='%(asctime)s - %(message)s', level=logging.INFO, filename='/var/log/bb-watchdog/bb-watchdog.log')
        is_up = is_interface_up(interface)
        print("is up: ", is_up)
        if is_up == True:
            logging.info("ok")
            counter1 = 0
            time.sleep(1)
        else:
            if counter1 < 3:
                logging.warning("ppp0 abajo")
                print("calling pppd call...")
                start_modem()
                print("command to start modem started")
                time.sleep(15)
                print("salio del sleep")
            elif counter1 < 5:
                logging.info("restarting modem device")
                restart_modem()
                time.sleep(20)
                logging.info("starting modem with pppd")
                start_modem()
                time.sleep(15)
            else:
                counter1 = 0
                # logging.info("going to reboot")
                # os.system("reboot")
            counter1 = counter1 + 1

with daemon.DaemonContext():
    print("hohohlahoa")
    do_main('ppp0')
