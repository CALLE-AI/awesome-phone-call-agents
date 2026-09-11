"""ASCII/reserved-fixture checks. No provider requests are allowed."""
import unittest
from unittest.mock import patch
import returnready as rr
from test_returnready import request, NOW
class ReviewFixTests(unittest.TestCase):
 def reject(self,n):
  r=request();r['phone']=n
  with self.assertRaises(ValueError):rr.validate_request(r,NOW)
 def test_ascii_reserved_fixture_for_preview(self):self.assertEqual(rr.validate_request(request(),NOW)['phone'],'+442079460123')
 def test_arabic_digits(self):self.reject('+44'+''.join(chr(0x660+int(x)) for x in '2079460123'))
 def test_fullwidth_digits(self):self.reject('+44'+''.join(chr(0xff10+int(x)) for x in '2079460123'))
 def test_devanagari_digits(self):self.reject('+44'+''.join(chr(0x966+int(x)) for x in '2079460123'))
 def test_fullwidth_plus(self):self.reject(chr(0xff0b)+'442079460123')
 def test_leading_space(self):self.reject(' +442079460123')
 def test_trailing_space(self):self.reject('+442079460123 ')
 def test_trailing_newline(self):self.reject('+442079460123'+chr(10))
 def test_embedded_space(self):self.reject('+44 2079460123')
 def test_zero_country_prefix(self):self.reject('+042079460123')
 def test_overlength(self):self.reject('+'+'1'*16)
 def test_non_string(self):self.reject(123)
 def boundary(self,number,message):
  b=rr.payload(rr.validate_request(request(),NOW),'synthetic_request');b['recipients'][0]['phones']=[number]
  with patch('urllib.request.build_opener') as opener:
   with self.assertRaisesRegex(ValueError,message):rr.CalleHTTP('TEST-ONLY').start(b,'synthetic_request')
   opener.assert_not_called()
 def test_london_reserved_boundary(self):self.boundary('+442079460123','Reserved fictional')
 def test_mobile_reserved_boundary(self):self.boundary('+447700900123','Reserved fictional')
 def test_nanp_reserved_boundary(self):self.boundary('+12025550123','Reserved fictional')
 def test_unicode_transport_boundary(self):self.boundary('+44'+chr(0x661)*10,'ASCII')
 def test_injected_spy_retains_fixture(self):
  calls=[];c=rr.CalleHTTP('TEST-ONLY',transport=lambda *a:calls.append(a) or {'id':'synthetic'})
  c.start(rr.payload(rr.validate_request(request(),NOW),'synthetic_request'),'synthetic_request');self.assertEqual(len(calls),1)
if __name__=='__main__':unittest.main()
