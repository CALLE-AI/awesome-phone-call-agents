import pytest
from honeybot import HoneybotExtractor

def test_extract_iocs():
    extractor = HoneybotExtractor()
    
    # Test URL extraction
    text1 = "Go to www.fake-bank-login.com to secure your account."
    res1 = extractor.extract_iocs(text1)
    assert "www.fake-bank-login.com" in res1["urls"]
    
    # Test Crypto extraction
    text2 = "Send the money to 1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa immediately."
    res2 = extractor.extract_iocs(text2)
    assert "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa" in res2["crypto_wallets"]

def test_process_scammer_turn_compliance():
    extractor = HoneybotExtractor()
    text = "Send it to 1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa."
    
    # Must accept valid test number
    result = extractor.process_scammer_turn("555-0155", text)
    assert result["action"] == "continue_baiting"
    
    # Must reject non-compliant number
    with pytest.raises(ValueError):
        extractor.process_scammer_turn("999-123-4567", text)
