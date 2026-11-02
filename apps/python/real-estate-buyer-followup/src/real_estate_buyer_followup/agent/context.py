"""Source preparation and an explicit deterministic, offline assessment mode.

This mode demonstrates inspectable rules. It is not an LLM evaluation result.
"""
from datetime import date
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
            raise ValueError("上下文判断引用了不存在或不相关的来源")
        if item.category == "fact" and all(allowed[x].get("kind") == "broker_observation" for x in item.source_ids):
            raise ValueError("经纪人观察不能作为客户确认事实")
    if not set(assessment.selected_sources) <= allowed.keys():
        raise ValueError("知识包包含无效来源")
    for excluded in assessment.excluded:
        if excluded.get("source_id") not in allowed:
            raise ValueError("排除项引用无效来源")
    library={e['id']:e for e in context.get('knowledge_library',[])}
    used=set()
    for use in assessment.policy_uses:
        if use.source_id not in library:
            raise ValueError('选用的政策不在当前知识库中')
        entry=library[use.source_id]
        if use.paragraph_indices:
            paragraphs={p['paragraph_index']:p['text'] for p in entry['paragraphs']}
            if len(set(use.paragraph_indices))!=len(use.paragraph_indices) or any(i not in paragraphs for i in use.paragraph_indices):
                raise ValueError('政策段落编号不在该条目中')
            # The model selects paragraph IDs; the program copies source text.
            # Do not ask the model to reproduce long legal prose characterwise.
            use.excerpt='\n\n'.join(paragraphs[i] for i in use.paragraph_indices)
        elif not use.excerpt or use.excerpt not in entry['text']:
            raise ValueError('政策摘录必须为知识库原文')
        if entry['effective']>context['evaluation_date']:
            raise ValueError('不能采用尚未生效的政策')
        if use.source_id in used:
            raise ValueError('政策引用重复')
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
    insights = [{"category":"fact", "text":f"当前资料：{context['customer']['preferences']}。是否改变需用户表达。", "source_ids":["customer_profile"]}]
    for v in context["viewings"]:
        insights.append({"category":"fact", "text":f"已带看 {v['property_id']}，需单独收集反馈。", "source_ids":[v["id"],v["property_id"]]})
    if "source_budget_old" in sources and "source_budget_latest" in sources:
        if sources["source_budget_old"]["text"] != sources["source_budget_latest"]["text"]:
            insights.append({"category":"conflict", "text":"历史预算口径不同；当前明确上限优先保留，出现取舍信号时再核实，不自动提高。", "source_ids":["source_budget_old","source_budget_latest","customer_profile"]})
    if "source_space_observation" in sources:
        insights.append({"category":"hypothesis", "text":"经纪人观察提示可能在意客厅，需要询问；尚非客户确认偏好。", "source_ids":["source_space_observation"]})
    if "source_preference_change" in sources:
        change = sources["source_preference_change"]
        # Before the viewing, the customer mentioned space but made no tradeoff.
        # Acceptance of a longer walk is learned only in the follow-up replay.
        if "客厅" in change["text"]:
            insights.extend([
                {"category":"fact", "text":"10月20日提到客厅空间也很重要，未明确空间、交通和预算的优先级。", "source_ids":["source_preference_change"]},
                {"category":"hypothesis", "text":"两套房的空间、交通和价格差异适合了解取舍；尚不能认定客户愿意放宽地铁距离。", "source_ids":["source_preference_change","customer_profile"]},
                {"category":"gap", "text":"尚未收集实际看房反馈、需求取舍和后续跟进意愿。", "source_ids":["source_preference_change"]},
            ])
    for p in context["properties"]:
        if p["id"] not in sources:
            continue
        if p["price"] > context["customer"]["preferences"]["budget_max"]:
            insights.append({"category":"conflict", "text":f"{p['label']}报价超过明确预算；只能了解取舍，不能推断预算已增加。", "source_ids":[p["id"],"customer_profile"]})
        if "需核实" in p["status"] or (date.fromisoformat(context["evaluation_date"]) - date.fromisoformat(p["updated_at"])).days > 14 or p["status"] == "需核实":
            insights.append({"category":"gap", "text":f"{p['label']}状态或报价需要核实，不承诺可售、降价或议价空间。", "source_ids":[p["id"]]})
    for item in insights:
        item['confidence'] = 'high' if item['category']=='fact' else 'medium'
        item['action'] = {'fact':'采用已有信息，避免从零重复提问', 'hypothesis':'通话确认变化与可接受范围', 'conflict':'核实取舍，不擅自覆盖确认值', 'gap':'优先补齐缺口；未知不承诺'}[item['category']]
    excluded = [{"source_id":"source_irrelevant", "reason":"咖啡喜好与本次带看反馈没有直接关系"}] if "source_irrelevant" in sources else []
    return validate_assessment(Assessment(summary="按本地可解释规则形成的客户理解，非在线模型推理。", insights=insights, selected_sources=selected, excluded=excluded), context)
