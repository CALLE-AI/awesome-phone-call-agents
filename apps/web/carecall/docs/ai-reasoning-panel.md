# AI reasoning panel — datos disponibles

Guia para construir el panel de razonamiento en el dashboard. **No he tocado ningun `.razor`**: toda la
informacion ya esta persistida y lista para consumir.

## Tabla `AgentTraces`

Cada llamada procesada genera una fila por agente ejecutado.

| Columna | Tipo | Notas |
|---|---|---|
| `Id` | Guid | PK |
| `CallSessionId` | Guid? | **Nullable.** El QuestionPlanner corre antes de la llamada |
| `PatientId` | Guid | Siempre presente |
| `Agent` | `AgentKind` | Ver enum abajo |
| `Outcome` | string(500) | Resumen corto ya legible, listo para pintar en una fila |
| `Rationale` | string(2000) | Explicacion del agente en lenguaje natural |
| `RawJson` | string | Respuesta cruda del modelo, para un "ver detalle" |
| `Succeeded` | bool | `false` = el agente fallo pero el pipeline continuo |
| `ElapsedMs` | long | Latencia, util para mostrar rendimiento en la demo |
| `CreatedOn` | DateTime | Ordena por aqui para reconstruir la secuencia |

Hay indices por `(CallSessionId, Agent)` y por `PatientId`.

> Las trazas sobreviven al borrado de la `CallSession` (`DeleteBehavior.SetNull`): son auditoria clinica.

## `AgentKind`

```
0 QuestionPlanner    antes de la llamada: preguntas personalizadas
1 TrendAnalyst       tendencia de toda la serie de llamadas
2 Analyst            analisis de la llamada actual
3 DevilsAdvocate     revision de seguridad (solo en casos de riesgo o dudosos)
4 ClinicalHandoff    nota SBAR
5 AdaptiveScheduler  cuando volver a llamar
```

## Orden de ejecucion

```
QuestionPlanner  ->  [LLAMADA]  ->  TrendAnalyst -> Analyst -> DevilsAdvocate* -> ClinicalHandoff -> AdaptiveScheduler
```

`*` El Devil's Advocate **solo se ejecuta** si el riesgo es High, hay empeoramiento, o la transcripcion
es muy corta. Si no aparece en las trazas, no es un error: es que el caso era benigno y claro.

## Consulta sugerida

```csharp
var traces = await db.AgentTraces
	.AsNoTracking()
	.Where(t => t.CallSessionId == callSessionId)
	.OrderBy(t => t.CreatedOn)
	.ToListAsync();
```

## Formato de `RawJson` por agente

- **TrendAnalyst**: `trajectory` ("Improving"/"Stable"/"Worsening"/"Unknown"), `progressiveFindings[]`, `gradualDeteriorationDetected`, `rationale`
- **DevilsAdvocate**: `challengeFound`, `overriddenRisk`, `supportingQuote`, `missedFindings[]`, `rationale`, `quoteVerified`
- **ClinicalHandoff**: `situation`, `background`, `assessment`, `recommendation` (las 4 secciones SBAR)
- **AdaptiveScheduler**: `nextCallInDays`, `dischargeFollowUp`, `rationale`
- **QuestionPlanner**: `questions[]`, `followUpPoints[]`, `redFlags[]`, `rationale`

## Lo que mas luce en la demo

El caso fuerte es cuando el **Devil's Advocate eleva el riesgo**. Ejemplo real ya en la base de datos
(paciente Jose Luis Marin, EPOC): el analista clasifico **Medium**, y el revisor lo subio a **High**
citando literalmente al paciente:

> "Ahora tengo que descansar en el primer rellano, pero sera que estoy mayor."

Merece la pena destacar visualmente `supportingQuote` y `missedFindings`: muestra que el sistema
detecto un deterioro que el propio paciente estaba minimizando.

## Garantias que puedes afirmar en la presentacion

Estan implementadas **en codigo y cubiertas por tests**, no dependen del prompt:

- El Devil's Advocate solo altera el riesgo si su cita aparece **literalmente** en la transcripcion
  (`quoteVerified`). Si el modelo la inventa, se descarta.
- Solo puede **subir** el riesgo, y como maximo **un nivel**.
- El scheduler nunca programa a menos de 24h ni mas de 14 dias.
- Nunca se cierra el seguimiento de un paciente con empeoramiento o riesgo alto.
- Las **alertas siguen siendo deterministas** (`AlertRules`): los agentes aportan contenido clinico,
  no deciden las alertas.
- Si un agente falla, el pipeline continua y la llamada nunca se pierde.
