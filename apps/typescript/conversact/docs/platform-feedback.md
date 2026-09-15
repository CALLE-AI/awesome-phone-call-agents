# Platform feedback

## Historical recipient contract drift

During hackathon development, an earlier published integration example used a singular recipient object while the live API integration required the plural recipient/phones shape. This is historical beta documentation drift, not a claim about current documentation; contributors should check the current SDK and docs before changing integration code.

## Nigeria routing readiness

During development, a direct Nigerian `+234` call request returned `422 call_not_ready`. Provider support attributed this to regional risk controls. Conversact treats equivalent provider routing errors as an unavailable route: it keeps the diagnostic reason, stops, and creates no commerce or payment side effect.

A machine-readable destination-capability/readiness preflight would let applications disclose unavailable routes before a provider create request.
