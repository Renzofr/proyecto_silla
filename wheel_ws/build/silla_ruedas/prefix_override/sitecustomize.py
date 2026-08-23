import sys
if sys.prefix == '/usr':
    sys.real_prefix = sys.prefix
    sys.prefix = sys.exec_prefix = '/home/renzofr/Proyecto_silla/wheel_ws/install/silla_ruedas'
