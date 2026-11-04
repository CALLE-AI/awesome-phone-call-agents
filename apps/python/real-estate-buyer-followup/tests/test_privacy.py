"""Use reserved synthetic phone numbers only; never call a provider."""
import copy
import pytest
from real_estate_buyer_followup.demo.privacy import Presentation, redact


@pytest.mark.parametrize('number', [
    '+12025550123', '+1 (202) 555-0123', '(202) 555-0123',
    '202-555-0123', '202.555.0123', '202 555 0123', '555-0123',
    '2025550123 2025550124',
])
def test_numeric_phone_forms_are_hidden(number):
    rendered = redact(f'Please call {number}; this is my callback number.')
    assert number not in rendered
    assert '[phone hidden]' in rendered


def test_nested_structured_data_redacted_without_modifying_source():
    source = {'summary': 'Call +12025550123', 'nested': [
        {'quote': 'Use (202) 555-0123', 'phone': 12025550123},
        {'budget_max': 5000000, 'confirmed': False},
    ], '+12025550123': 'callback'}
    original = copy.deepcopy(source)
    display = redact(source)
    assert '+12025550123' not in str(display)
    assert '202) 555-0123' not in str(display)
    assert display['nested'][0]['phone'] == '[number hidden]'
    assert display['nested'][1] == {'budget_max': 5000000, 'confirmed': False}
    assert source == original
    assert redact('2026-10-30 source_ab1234567890cd') == '2026-10-30 source_ab1234567890cd'


class Recorder:
    def __init__(self): self.outputs = []
    def __getattr__(self, name):
        if name == 'columns': return lambda *a, **k: [self]
        def output(*args, **kwargs): self.outputs.append((name, args, kwargs))
        return output


def test_all_text_outputs_and_columns_share_the_guard():
    recorder = Recorder()
    ui = Presentation(recorder)
    for name in Presentation._OUTPUTS - {'exception'}:
        getattr(ui, name)('Callback +12025550123', help='Call (202) 555-0123')
    ui.exception(ValueError('Provider error +12025550123'))
    ui.columns(1)[0].metric('Callback', '+12025550123')
    assert recorder.outputs
    assert '+12025550123' not in str(recorder.outputs)
    assert '(202) 555-0123' not in str(recorder.outputs)
    assert '[phone hidden]' in str(recorder.outputs)


def test_real_result_renderers_hide_callback_and_keep_private_evidence(tmp_path, monkeypatch):
    from pathlib import Path
    from streamlit.testing.v1 import AppTest
    from real_estate_buyer_followup.config import Settings
    from real_estate_buyer_followup.services.workflow import Workflow
    w = Workflow(Settings(db_path=str(tmp_path / 'private.sqlite3')))
    run = w.prepare('customer_zhang', 'Collect independent viewing feedback')
    run = w.approve(run['id'], run['revision'], True)
    w.execute(run['id'])
    run = w.process(run['id'])
    phone = '+12025550123'
    text = 'Please have the broker call ' + phone
    run['call']['transcript'][1]['text'] = text
    run['call']['result']['summary'] = text
    run['call']['result']['p1_feedback'] = text
    run['call']['result']['nested'] = {'callback': phone}
    run['analysis']['summary'] = text
    run['batch']['accepted'][0]['value'] = text
    run['batch']['accepted'][0]['evidence']['quote'] = text
    run['batch']['handoff']['action'] = text
    run['batch']['handoff']['reason'] = text
    run['batch']['unresolved'] = [text]
    run['error'] = 'Provider error for ' + phone
    w.store.save_run(run, run['revision'])
    private_snapshot = copy.deepcopy(w.store.run(run['id']))
    monkeypatch.setattr(Settings, 'from_env', classmethod(lambda cls: Settings(db_path=w.settings.db_path)))
    app = Path(__file__).parents[1] / 'src/real_estate_buyer_followup/demo/streamlit_app.py'
    at = AppTest.from_file(app, default_timeout=30).run()
    # Rendering only: no model or telephone request is needed.
    for page in (at.radio[0].options[2], at.radio[0].options[3]):
        at.radio[0].set_value(page).run()
        assert not at.exception
        outputs = []
        for kind in ('markdown', 'caption', 'code', 'json', 'error', 'warning', 'info', 'success'):
            outputs.extend(str(node.value) for node in at.get(kind))
        assert phone not in '\n'.join(outputs)
        assert '[phone hidden]' in '\n'.join(outputs)
    assert w.store.run(run['id']) == private_snapshot
