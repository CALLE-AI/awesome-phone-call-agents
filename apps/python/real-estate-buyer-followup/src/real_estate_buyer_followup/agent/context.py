"""Source preparation and an explicit deterministic, offline assessment mode.

This mode demonstrates inspectable rules. It is not an LLM evaluation result.
"""
from datetime import date
import re
from ..models import Assessment


def source_map(context):
    c = context["customer"]
    sources = {"customer_profile": {"id":"customer_profile", "kind":"crm_profile", "text":c["preferences"]}}
    sources.update({x["id"]:x for x in context["communications"]})
    sources.update({v["id"]:v for v in context["viewings"]})
    viewed_ids = {v["property_id"] for v in context["viewings"]}
    candidate_ids = {p["property_id"] for p in context.get("candidates", [])}
    sources.update({p["id"]:p for p in context["properties"] if p["id"] in viewed_ids | candidate_ids})
    sources.update({e["id"]:e for e in context.get("knowledge_library",[])})
    return sources


def validate_assessment(assessment, context):
    allowed = source_map(context)
    for item in assessment.insights:
        if not set(item.source_ids) <= allowed.keys():
            raise ValueError('Context assessment references nonexistent or irrelevant sources')
        if item.category == "fact" and all(allowed[x].get("kind") == "broker_observation" for x in item.source_ids):
            raise ValueError('Broker observations are not confirmed customer facts')
    if not set(assessment.selected_sources) <= allowed.keys():
        raise ValueError('Context package contains invalid sources')
    for excluded in assessment.excluded:
        if excluded.get("source_id") not in allowed:
            raise ValueError('Excluded item references an invalid source')
    library={e['id']:e for e in context.get('knowledge_library',[])}
    used=set()
    for use in assessment.policy_uses:
        if use.source_id not in library:
            raise ValueError('Selected policy is not in the current knowledge library')
        entry=library[use.source_id]
        if use.paragraph_indices:
            paragraphs={p['paragraph_index']:p['text'] for p in entry['paragraphs']}
            if len(set(use.paragraph_indices))!=len(use.paragraph_indices) or any(i not in paragraphs for i in use.paragraph_indices):
                raise ValueError('Paragraph index is outside this entry')
            # The model selects paragraph IDs; the program copies source text.
            # Do not ask the model to reproduce long legal prose characterwise.
            use.excerpt='\n\n'.join(paragraphs[i] for i in use.paragraph_indices)
        elif not use.excerpt or use.excerpt not in entry['text']:
            raise ValueError('Policy excerpt must be copied from the knowledge source')
        if entry['effective']>context['evaluation_date']:
            raise ValueError('Policies not yet effective cannot be used')
        if use.source_id in used:
            raise ValueError('Duplicate policy reference')
        used.add(use.source_id)
    # The source catalog is provided for selection, not wholesale injection.
    # Unknown IDs were rejected above. Omit valid but unselected KB entries.
    assessment.selected_sources=[sid for sid in assessment.selected_sources if sid not in library or sid in used]
    assessment.selected_sources=list(dict.fromkeys(assessment.selected_sources+sorted(used)))
    return assessment


def selected_context(context, assessment):
    """Give planning only the policy paragraphs selected in the assessment."""
    selected={use.source_id for use in assessment.policy_uses}
    return {**context,'knowledge_library':[e for e in context.get('knowledge_library',[]) if e['id'] in selected]}


def assess_offline(context):
    sources = source_map(context)
    selected = [x for x in sources if x != "source_irrelevant" and not x.startswith("kb_")]
    insights = [{"category":"fact", "text":f"Current record: {context['customer']['preferences']}. A change requires an explicit customer statement.", "source_ids":["customer_profile"]}]
    for v in context["viewings"]:
        insights.append({"category":"fact", "text":f" viewed {v['property_id']}; collect its feedback separately.", "source_ids":[v["id"],v["property_id"]]})
    if "source_budget_old" in sources and "source_budget_latest" in sources:
        if sources["source_budget_old"]["text"] != sources["source_budget_latest"]["text"]:
            insights.append({"category":"conflict", "text":'Historical budget statements differ; retain the current explicit ceiling and clarify only when trade-off signals arise, without automatically increasing it.', "source_ids":["source_budget_old","source_budget_latest","customer_profile"]})
    if "source_space_observation" in sources:
        insights.append({"category":"hypothesis", "text":'Broker observations suggest living-room interest; ask the customer, as this is not yet a confirmed preference.', "source_ids":["source_space_observation"]})
    if "source_preference_change" in sources:
        change = sources["source_preference_change"]
        # Before the viewing, the customer mentioned space but made no tradeoff.
        # Acceptance of a longer walk is learned only in the follow-up replay.
        if re.search(r"living[- ]room|space", change["text"], re.I):
            insights.extend([
                {"category":"fact", "text":'On October 20 she said living-room space also matters, without ranking space, transport and budget.', "source_ids":["source_preference_change"]},
                {"category":"hypothesis", "text":'The properties differ in space, transport and price; explore trade-offs without assuming the customer accepts a longer metro walk.', "source_ids":["source_preference_change","customer_profile"]},
                {"category":"gap", "text":'Actual viewing feedback, trade-offs and follow-up preferences have not yet been collected.', "source_ids":["source_preference_change"]},
            ])
    for p in context["properties"]:
        if p["id"] not in sources:
            continue
        if p["price"] > context["customer"]["preferences"]["budget_max"]:
            insights.append({"category":"conflict", "text":f"{p['label']}Asking price exceeds the confirmed budget; explore trade-offs without assuming a budget increase.", "source_ids":[p["id"],"customer_profile"]})
        if 'Needs verification' in p["status"] or (date.fromisoformat(context["evaluation_date"]) - date.fromisoformat(p["updated_at"])).days > 14 or p["status"] == 'Needs verification':
            insights.append({"category":"gap", "text":f"{p['label']}Availability or price requires verification; do not promise availability, discounts or negotiation room.", "source_ids":[p["id"]]})
    for item in insights:
        item['confidence'] = 'high' if item['category']=='fact' else 'medium'
        item['action'] = {'fact':'Use existing information and avoid restarting from scratch', 'hypothesis':'Confirm changes and acceptable ranges during the call', 'conflict':'Clarify trade-offs without overwriting confirmed values', 'gap':'Fill relevant gaps first; do not promise unknown facts'}[item['category']]
    excluded = [{"source_id":"source_irrelevant", "reason":'Coffee preferences are unrelated to this viewing follow-up'}] if "source_irrelevant" in sources else []
    return validate_assessment(Assessment(summary='Customer assessment from explainable local rules, not online model inference.', insights=insights, selected_sources=selected, excluded=excluded), context)
