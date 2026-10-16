"""Series de numeración del DeCA: cada serie con su contador, todo DeCA
generado recibe número de su serie (tenga o no albarán), la serie por defecto
es única y una serie no cambia una vez generado el DeCA."""
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient, APITestCase


from .models import ExpedicionDeca, SerieNumeracionDeca
from .services import identificador_service

User = get_user_model()

URL_SERIES = '/api/v1/deca/series/'
URL_EXP = '/api/v1/deca/expediciones/'


class SeriesNumeracionDecaTests(APITestCase):
    def setUp(self):
        usuario = User.objects.create_user(username='admin@series.test', email='admin@series.test',
                                           password='Admin123!', is_staff=True)
        self.client = APIClient()
        self.client.force_authenticate(user=usuario)

    def _datos(self, **extra):
        return {
            'numero_albaran': 'A-1', 'nif_cargador': 'B12345674', 'nombre_cargador': 'Fabrica SL',
            'domicilio_cargador': 'Calle Mayor 1, 04001 Almería', 'nif_transportista': 'B12345674',
            'nombre_transportista': 'Transportes SL', 'nif_destinatario': 'B12345674', 'nombre_destinatario': 'Cliente SA',
            'matricula_tractor': '1234bbb', 'matricula_remolque': '5678ccc', 'origen': 'Almería', 'destino': 'Barcelona',
            'fecha_hora_transporte': timezone.now().isoformat(), 'naturaleza_mercancia': 'Tomate',
            'peso_kg': '12000.00', 'bultos': 500, **extra,
        }

    def _generar(self, **extra):
        crear = self.client.post(URL_EXP, self._datos(**extra))
        self.assertEqual(crear.status_code, status.HTTP_201_CREATED, crear.data)
        exp_id = crear.data['id']
        self.client.post(f'{URL_EXP}{exp_id}/confirmar/')
        generar = self.client.post(f'{URL_EXP}{exp_id}/generar/')
        self.assertEqual(generar.status_code, status.HTTP_200_OK, generar.data)
        return ExpedicionDeca.objects.get(id=exp_id)

    def _crear_serie(self, nombre, prefijo, **extra):
        resp = self.client.post(URL_SERIES, {'nombre': nombre, 'prefijo': prefijo, **extra})
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        return resp.data

    def test_con_albaran_tambien_lleva_numero_de_la_serie_por_defecto(self):
        exp = self._generar()
        self.assertEqual(exp.numero_interno, 'DECA-00001')
        self.assertEqual(exp.serie.nombre, 'General')
        # Lo que se enseña al cliente sigue siendo el albarán (referencia preferida).
        self.assertEqual(identificador_service.identificador_expedicion(exp), 'A-1')

    def test_sin_albaran_la_referencia_es_el_numero_de_serie(self):
        exp = self._generar(numero_albaran='')
        self.assertEqual(identificador_service.identificador_expedicion(exp), 'DECA-00001')

    def test_cada_serie_lleva_su_propio_contador(self):
        alg = self._crear_serie('Algodón', 'DECA_ALG-', digitos=2)
        tom = self._crear_serie('Tomates', 'DECA_TOM-')
        self.assertEqual(self._generar(serie=alg['id']).numero_interno, 'DECA_ALG-01')
        self.assertEqual(self._generar(serie=alg['id']).numero_interno, 'DECA_ALG-02')
        self.assertEqual(self._generar(serie=tom['id']).numero_interno, 'DECA_TOM-00001')
        self.assertEqual(self._generar().numero_interno, 'DECA-00001')

    def test_solo_una_serie_por_defecto(self):
        self._generar()  # crea la serie General por defecto
        tom = self._crear_serie('Tomates', 'DECA_TOM-')
        self.client.patch(f'{URL_SERIES}{tom["id"]}/', {'por_defecto': True})
        por_defecto = SerieNumeracionDeca.objects.filter(por_defecto=True)
        self.assertEqual([s.nombre for s in por_defecto], ['Tomates'])
        self.assertEqual(self._generar().numero_interno, 'DECA_TOM-00001')

    def test_no_se_desactiva_la_serie_por_defecto(self):
        tom = self._crear_serie('Tomates', 'DECA_TOM-', por_defecto=True)
        resp = self.client.patch(f'{URL_SERIES}{tom["id"]}/', {'activa': False})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_no_se_borra_una_serie_usada_pero_si_una_sin_usar(self):
        tom = self._crear_serie('Tomates', 'DECA_TOM-')
        sin_usar = self._crear_serie('Algodón', 'DECA_ALG-')
        self._generar(serie=tom['id'])
        self.assertEqual(self.client.delete(f'{URL_SERIES}{tom["id"]}/').status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(self.client.delete(f'{URL_SERIES}{sin_usar["id"]}/').status_code, status.HTTP_204_NO_CONTENT)

    def test_el_contador_no_se_toca_a_mano(self):
        tom = self._crear_serie('Tomates', 'DECA_TOM-')
        self.client.patch(f'{URL_SERIES}{tom["id"]}/', {'ultimo_numero': 99})
        self.assertEqual(SerieNumeracionDeca.objects.get(id=tom['id']).ultimo_numero, 0)

    def test_la_serie_no_cambia_una_vez_generado(self):
        tom = self._crear_serie('Tomates', 'DECA_TOM-')
        alg = self._crear_serie('Algodón', 'DECA_ALG-')
        exp = self._generar(serie=tom['id'])
        resp = self.client.patch(f'{URL_EXP}{exp.id}/', {'serie': alg['id']})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST, resp.data)
        exp.refresh_from_db()
        self.assertEqual((exp.serie_id, exp.numero_interno), (exp.serie_id, 'DECA_TOM-00001'))
        self.assertEqual(str(exp.serie_id), tom['id'])

    def test_la_configuracion_trae_las_series_para_trabajar_sin_cobertura(self):
        self._crear_serie('Tomates', 'DECA_TOM-')
        datos = self.client.get('/api/v1/deca/configuracion/').data
        self.assertIn('Tomates', [s['nombre'] for s in datos['series']])
        self.assertIn('General', [s['nombre'] for s in datos['series']])

    def test_filtro_y_columna_del_listado(self):
        tom = self._crear_serie('Tomates', 'DECA_TOM-')
        self._generar(serie=tom['id'])
        self._generar()
        filas = self.client.get(URL_EXP, {'serie': tom['id']}).data['results']
        self.assertEqual([(f['numero_interno'], f['serie_nombre']) for f in filas], [('DECA_TOM-00001', 'Tomates')])
