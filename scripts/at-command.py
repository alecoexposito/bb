import serial
import sys
with serial.serial_for_url('/dev/ttyUSB2', 115200, timeout=4) as s:
    print("comando a correr: " + sys.argv[1])
    s.write(str(sys.argv[1]) + '\r\n')
    line = s.readline()
    print(line)
    line = s.readline()
    print(line)
    line = s.readline()
    print(line)
    line = s.readline()
    print(line)
