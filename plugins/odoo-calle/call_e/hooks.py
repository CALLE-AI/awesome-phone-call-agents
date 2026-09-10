import logging
from odoo.exceptions import UserError

_logger = logging.getLogger(__name__)


def pre_init_hook(env):
    """
    Check if the required 'calle-ai' Python library is installed before module installation.
    """
    try:
        import calle
    except ImportError:
        raise UserError(
            "The 'calle-ai' Python library is required to install the CALL-E Integration module.\n\n"
            "Please install it in your environment by running:\n"
            "pip install calle-ai"
        )
