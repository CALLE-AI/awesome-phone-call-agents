"""Seed demo data: 3 candidates with different outcomes."""
import sys
import store
import llm


# ── Alex Morgan: mixed signals, the interesting case ──────────────────────
ALEX_TRANSCRIPTS = {
    "Jordan Lee": {
        "relation": "Former Manager",
        "transcript": """Bot: Hi, this is VouchCall, an automated reference checking service. Am I speaking with Jordan Lee?
User: Yes, this is Jordan.
Bot: Great. Alex Morgan listed you as a reference for a Senior Software Engineer position. Just to let you know, this call will be analyzed by AI to summarize your feedback. Is that okay with you?
User: Yes, go ahead.
Bot: Thanks. How long did you work with Alex, and in what capacity?
User: I worked with him for 2 years and I was his manager.
Bot: Got it. What would you say were Alex's greatest strengths?
User: He was one of the best engineers in our team and he had the ability to take ownership of work. During our service migration last year, Alex pretty much led the whole thing and delivered it early. And he's great with the team, always helping unblock other engineers.
Bot: Thanks. How did Alex work with the team?
User: Fantastic. He was a complete team player. He did code reviews thoroughly, mentored junior devs, and was always the first to offer help.
Bot: Was Alex reliable with deadlines and commitments?
User: Very reliable. If I give a deadline, he would complete it beforehand. I never had to chase him.
Bot: Were there any areas where Alex could grow or improve?
User: If I had to pick one thing, Alex could be a bit more vocal in larger meetings. In one-on-ones and small groups he's great, but in all-hands or cross-team meetings he tends to stay quiet.
Bot: On a scale of 1 to 10, how strongly would you recommend Alex for this role?
User: I'd say a 9. I'd hire him again in a heartbeat.
Bot: Thank you so much for your time, Jordan Lee. Your input is really valuable. Have a great day.""",
    },
    "Priya Sharma": {
        "relation": "Team Lead / Peer",
        "transcript": """Bot: Hi, this is VouchCall, an automated reference checking service. Am I speaking with Priya Sharma?
User: Yes, that's me.
Bot: Great. Alex Morgan listed you as a reference for a Senior Software Engineer position. Just to let you know, this call will be analyzed by AI to summarize your feedback. Is that okay with you?
User: Sure, no problem.
Bot: How long did you work with Alex, and in what capacity?
User: We were on adjacent teams. I led the platform team and Alex was on the services team. We collaborated on a few cross-team projects over about a year and a half.
Bot: What would you say were Alex's greatest strengths?
User: Technically, Alex is outstanding. Probably one of the strongest engineers I've worked with. He has a really creative approach to architecture and finds elegant solutions that others wouldn't think of.
Bot: How did Alex work with the team?
User: Within his own team, great. On cross-team stuff it was mostly good. Sometimes Alex would go deep on a solution without checking in, and we'd realize the direction had drifted from what we agreed on.
Bot: Could you share more about that?
User: Yeah, there was a project where we agreed on an approach in a design review, but Alex went off and built something more complex. It was technically better, but it wasn't what we aligned on and it delayed the integration by a week.
Bot: Was Alex reliable with deadlines and commitments?
User: This is where I'd be honest. There were a couple of times where deadlines slipped. Not on small stuff, but on bigger cross-team deliverables. I think Alex tends to perfect things rather than ship them. When focused on one thing the output is outstanding, but when juggling multiple projects, things could fall through the cracks.
Bot: Were there any areas where Alex could grow or improve?
User: Definitely the deadline thing. Also, I think Alex can over-engineer sometimes. Not everything needs to be the most elegant solution. Sometimes good enough on time is better than perfect and late.
Bot: On a scale of 1 to 10, how strongly would you recommend Alex for this role?
User: I'd say a 7. Good engineer, I'd recommend him, but whoever manages him should be aware of the multitasking thing.
Bot: Thank you so much for your time, Priya. Your input is really valuable. Have a great day.""",
    },
    "Michael Chen": {
        "relation": "Skip-Level Manager",
        "transcript": """Bot: Hi, this is VouchCall, an automated reference checking service. Am I speaking with Michael Chen?
User: Yes, speaking.
Bot: Great. Alex Morgan listed you as a reference for a Senior Software Engineer position. Just to let you know, this call will be analyzed by AI to summarize your feedback. Is that okay with you?
User: Sure, that's fine.
Bot: How long did you work with Alex, and in what capacity?
User: I was the senior director overseeing Alex's team. So I didn't work with him day-to-day, but I observed his work in project reviews and cross-functional meetings for about a year.
Bot: What would you say were Alex's greatest strengths?
User: Alex does solid technical work, no question. When he takes on a deep technical problem, the output is consistently good. He's a strong individual contributor.
Bot: How did Alex work with the team?
User: At the team level, fine. At the cross-functional level, that's where I'd want to see growth. In meetings with product and design, Alex wasn't always the best at translating technical decisions into business context.
Bot: Was Alex reliable with deadlines and commitments?
User: For the technical work itself, decent. My concern was more about visibility. There were times I had to chase Alex for status updates on critical projects. At a senior level, I expect engineers to proactively communicate up, not wait to be asked.
Bot: Were there any areas where Alex could grow or improve?
User: Two things. One, communication with non-technical stakeholders. Two, leadership presence. For a senior engineer role, I'd want to see more initiative in driving direction, not just executing well. Alex is great at the what but could improve on the why and so what for the broader organization.
Bot: On a scale of 1 to 10, how strongly would you recommend Alex for this role?
User: I'd say a 6. Good engineer, but for a senior role specifically, I'd want to see more leadership maturity. If this were a mid-level role, I'd be more enthusiastic.
Bot: Thank you so much for your time, Michael. Your input is really valuable. Have a great day.""",
    },
}


def _seed_candidate_hardcoded(name, role, refs_data, analysis_data):
    """Seed a candidate with pre-computed data (no Gemini calls)."""
    cid = store.add_candidate(name=name, role_title=role)
    print(f"\nCreated candidate '{name}' (ID: {cid})")

    for ref in refs_data:
        rid = store.add_reference(cid, ref["name"], "+10000000000", ref["relation"])
        store.save_call(
            ref_id=rid, candidate_id=cid,
            calle_call_id=f"demo_{ref['name'].lower().replace(' ', '_')}",
            status="completed", scores=ref["scores"],
            strengths=ref["strengths"], growth_areas=ref["growth_areas"],
            overall_recommendation=ref["recommendation"],
            key_quotes=ref["quotes"], summary=ref["summary"],
            transcript=ref.get("transcript", ""),
            quality_status=ref.get("quality_status", "verified"),
        )
        avg = sum(ref["scores"].values()) / len(ref["scores"])
        print(f"  {ref['name']}: avg {avg:.1f}/10, rec: {ref['recommendation']}")

    store.save_analysis(candidate_id=cid, **analysis_data)
    print(f"    Result: {analysis_data['hire_recommendation']} ({analysis_data['confidence_score']}% confidence)")
    return cid


ALEX_HARDCODED = {
    "refs_data": [
        {
            "name": "Jordan Lee",
            "relation": "Former Manager",
            "scores": {"collaboration": 9, "technical_ability": 9, "reliability": 9, "communication": 7, "leadership": 7},
            "strengths": ["Takes ownership of hard problems", "Strong team player who mentors junior devs", "Delivered service migration early"],
            "growth_areas": ["Could be more vocal in larger meetings"],
            "recommendation": "strong_yes",
            "quotes": [
                "He was one of the best engineers in our team",
                "I'd hire him again in a heartbeat",
                "He did code reviews thoroughly, mentored junior devs, and was always the first to offer help",
            ],
            "summary": "Jordan gives a glowing review. Describes Alex as one of the best engineers he's managed, highlighting ownership, team collaboration, and reliability. Only growth area is presence in large meetings.",
            "transcript": ALEX_TRANSCRIPTS["Jordan Lee"]["transcript"],
            "quality_status": "verified",
        },
        {
            "name": "Priya Sharma",
            "relation": "Team Lead / Peer",
            "scores": {"collaboration": 7, "technical_ability": 9, "reliability": 6, "communication": 6, "leadership": 6},
            "strengths": ["Outstanding technical ability", "Creative approach to architecture", "Finds elegant solutions"],
            "growth_areas": ["Tends to over-engineer", "Deadlines slip on cross-team deliverables", "Goes deep without checking in"],
            "recommendation": "yes",
            "quotes": [
                "Technically, Alex is outstanding. Probably one of the strongest engineers I've worked with",
                "Sometimes good enough on time is better than perfect and late",
                "Whoever manages him should be aware of the multitasking thing",
            ],
            "summary": "Priya is positive but flags concerns. Rates Alex's technical ability highly but raises reliability issues on cross-team work, tendency to over-engineer, and occasional misalignment with agreed approaches.",
            "transcript": ALEX_TRANSCRIPTS["Priya Sharma"]["transcript"],
            "quality_status": "verified",
        },
        {
            "name": "Michael Chen",
            "relation": "Skip-Level Manager",
            "scores": {"collaboration": 6, "technical_ability": 8, "reliability": 5, "communication": 5, "leadership": 4},
            "strengths": ["Strong individual contributor", "Consistently good technical output"],
            "growth_areas": ["Communication with non-technical stakeholders", "Leadership presence", "Proactive status updates"],
            "recommendation": "neutral",
            "quotes": [
                "Alex does solid technical work, no question",
                "I expect engineers to proactively communicate up, not wait to be asked",
                "Good engineer, but for a senior role specifically, I'd want to see more leadership maturity",
            ],
            "summary": "Michael gives a cautious mixed review. Acknowledges strong technical work but raises concerns about cross-functional communication, leadership presence, and proactive visibility at the senior level.",
            "transcript": ALEX_TRANSCRIPTS["Michael Chen"]["transcript"],
            "quality_status": "verified",
        },
    ],
    "analysis_data": {
        "discrepancies": [
            {
                "dimension": "reliability",
                "detail": "Jordan rates reliability 9/10 (never missed a deadline), while Priya rates it 6/10 (deadlines slipped on cross-team work) and Michael rates it 5/10 (had to chase for status updates). The gap suggests Alex is reliable within his own team but struggles with cross-team commitments.",
                "severity": "major",
            },
            {
                "dimension": "leadership",
                "detail": "Jordan rates leadership 7/10 (good team contributor), Priya 6/10 (goes off on his own), Michael 4/10 (lacks leadership presence). Clear downward trend as organizational distance increases — Alex's leadership doesn't scale beyond his immediate team.",
                "severity": "notable",
            },
            {
                "dimension": "communication",
                "detail": "Jordan notes quietness in large meetings but rates communication 7/10. Priya (6/10) flags misalignment on agreed approaches. Michael (5/10) raises inability to translate technical decisions into business context. Pattern: communication degrades outside comfort zone.",
                "severity": "notable",
            },
        ],
        "overall_summary": "Alex Morgan is a technically outstanding engineer with strong individual contributor skills, consistently praised for ownership and code quality. However, a clear pattern emerges across references: his strengths are most visible within his immediate team, while cross-functional collaboration, communication, and leadership presence weaken as scope increases. For a senior role, the reliability and communication gaps flagged by the peer and skip-level manager are significant concerns that need addressing.",
        "hire_recommendation": "lean_hire",
        "confidence_score": 72,
    },
}


def seed():
    store.init_db()

    use_gemini = "--gemini" in sys.argv

    # ── Candidate 1: Alex Morgan — mixed signals ────
    if use_gemini:
        from config import require_keys
        require_keys("GEMINI_API_KEY")
        print("Using Gemini for Alex Morgan analysis (--gemini flag)")
        cid = store.add_candidate(name="Alex Morgan", role_title="Senior Software Engineer")
        refs = {}
        for ref_name, data in ALEX_TRANSCRIPTS.items():
            refs[ref_name] = store.add_reference(cid, ref_name, "+10000000000", data["relation"])
        for ref_name, data in ALEX_TRANSCRIPTS.items():
            print(f"  Analyzing {ref_name}...")
            call_result = {"status": "completed", "summary": f"Reference check with {ref_name} completed.", "transcript": data["transcript"]}
            analysis = llm.analyze_call_result(candidate_name="Alex Morgan", ref_name=ref_name, ref_relation=data["relation"], call_result=call_result)
            scores = {d: analysis.get(f"{d}_score", 0) for d in ("collaboration", "technical_ability", "reliability", "communication", "leadership")}
            store.save_call(ref_id=refs[ref_name], candidate_id=cid, calle_call_id=f"demo_{ref_name.lower().replace(' ', '_')}",
                            status="completed", scores=scores, strengths=analysis.get("strengths", []), growth_areas=analysis.get("growth_areas", []),
                            overall_recommendation=analysis.get("overall_recommendation", "neutral"), key_quotes=analysis.get("key_quotes", []),
                            summary=analysis.get("ref_summary", ""), transcript=data["transcript"], quality_status="verified")
            print(f"    avg: {sum(scores.values()) / len(scores):.1f}/10, rec: {analysis.get('overall_recommendation')}")
        print("  Cross-reference analysis...")
        calls = store.get_calls_for_candidate(cid)
        cross = llm.cross_reference_analysis(candidate_name="Alex Morgan", role_title="Senior Software Engineer", calls=calls)
        store.save_analysis(candidate_id=cid, discrepancies=cross.get("discrepancies", []), overall_summary=cross.get("overall_summary", ""),
                            hire_recommendation=cross.get("hire_recommendation", ""), confidence_score=cross.get("confidence_score", 0))
        print(f"    Result: {cross.get('hire_recommendation')} ({cross.get('confidence_score')}% confidence)")
    else:
        _seed_candidate_hardcoded(
            "Alex Morgan", "Senior Software Engineer",
            refs_data=ALEX_HARDCODED["refs_data"],
            analysis_data=ALEX_HARDCODED["analysis_data"],
        )

    # ── Candidate 2: Sarah Patel — strong hire, consistent praise ─────
    _seed_candidate_hardcoded(
        "Sarah Patel", "Engineering Manager",
        refs_data=[
            {
                "name": "David Kim",
                "relation": "Direct Report",
                "scores": {"collaboration": 9, "technical_ability": 8, "reliability": 9, "communication": 9, "leadership": 10},
                "strengths": ["Exceptional people manager", "Creates psychological safety", "Clear communicator who shields the team from noise"],
                "growth_areas": ["Could delegate more instead of jumping in to help"],
                "recommendation": "strong_yes",
                "quotes": [
                    "Sarah is the best manager I've ever had, bar none.",
                    "She fought for our team's priorities in every planning cycle and won.",
                    "I grew more in one year under Sarah than in three years before that.",
                ],
                "summary": "David is effusive in his praise. Describes Sarah as the most impactful manager he's worked with, highlighting her ability to grow people and shield the team while still delivering results.",
                "quality_status": "verified",
            },
            {
                "name": "Rachel Torres",
                "relation": "Peer Engineering Manager",
                "scores": {"collaboration": 9, "technical_ability": 7, "reliability": 10, "communication": 9, "leadership": 9},
                "strengths": ["Reliable partner on cross-team work", "Keeps commitments", "Strong at stakeholder management"],
                "growth_areas": ["Sometimes too protective of her team's capacity"],
                "recommendation": "strong_yes",
                "quotes": [
                    "If Sarah says her team will deliver by Friday, it's done by Thursday.",
                    "She's the manager I most want to partner with on cross-org projects.",
                    "The only friction is she'll push back hard if you try to overload her team, but honestly that's a strength.",
                ],
                "summary": "Rachel highlights Sarah's reliability and cross-team collaboration. Notes she's protective of her team, which occasionally creates friction but is ultimately seen as effective leadership.",
                "quality_status": "verified",
            },
            {
                "name": "James Wright",
                "relation": "VP of Engineering (Former Manager)",
                "scores": {"collaboration": 8, "technical_ability": 7, "reliability": 9, "communication": 10, "leadership": 9},
                "strengths": ["Strategic thinker", "Develops talent pipeline", "Excellent upward communication"],
                "growth_areas": ["Could take on more org-wide initiatives beyond her team"],
                "recommendation": "strong_yes",
                "quotes": [
                    "Sarah is ready for a director role. I told her that before she left.",
                    "She turned a struggling team into one of our highest-performing groups in two quarters.",
                    "Every skip-level I did with her reports confirmed what I already knew — they loved working for her.",
                ],
                "summary": "James gives an unqualified strong recommendation. Believes Sarah is already operating above her level and is ready for a director position. Highlights her ability to turn around underperforming teams.",
                "quality_status": "verified",
            },
        ],
        analysis_data={
            "discrepancies": [
                {
                    "dimension": "technical_ability",
                    "detail": "David rates technical ability 8/10 while Rachel and James rate it 7/10. Minor gap — Sarah is being evaluated for a management role where technical depth is less critical, and all agree she's technically sufficient.",
                    "severity": "minor",
                },
            ],
            "overall_summary": "Sarah Patel receives uniformly strong recommendations across all three references spanning direct reports, peers, and leadership. Every reference emphasizes her people management skills, reliability, and communication. The consistency across different perspectives and levels is notable — there are no significant discrepancies. Sarah appears to be a high-performing engineering manager ready for increased scope.",
            "hire_recommendation": "strong_hire",
            "confidence_score": 95,
        },
    )

    # ── Candidate 3: Ryan Cooper — concerning patterns, no hire ───────
    _seed_candidate_hardcoded(
        "Ryan Cooper", "Product Manager",
        refs_data=[
            {
                "name": "Lisa Nakamura",
                "relation": "Former Manager",
                "scores": {"collaboration": 5, "technical_ability": 7, "reliability": 4, "communication": 6, "leadership": 5},
                "strengths": ["Good analytical skills", "Strong with data and metrics"],
                "growth_areas": ["Misses deadlines frequently", "Struggles with stakeholder alignment", "Can be dismissive of engineering concerns"],
                "recommendation": "hesitant",
                "quotes": [
                    "Ryan is smart, there's no question. But smart isn't enough for a PM role.",
                    "I spent more time managing Ryan's stakeholder relationships than I should have needed to.",
                    "There were sprint commitments that slipped multiple times and it eroded trust with the engineering team.",
                ],
                "summary": "Lisa gives a measured but hesitant recommendation. Acknowledges Ryan's analytical strengths but raises serious concerns about reliability, stakeholder management, and team dynamics.",
                "quality_status": "verified",
            },
            {
                "name": "Tom Hartley",
                "relation": "Engineering Lead (Cross-functional Partner)",
                "scores": {"collaboration": 3, "technical_ability": 6, "reliability": 3, "communication": 4, "leadership": 4},
                "strengths": ["Understands the product deeply", "Good at competitive analysis"],
                "growth_areas": ["Doesn't listen to engineering pushback", "Specs are often incomplete", "Changes priorities without communicating"],
                "recommendation": "no",
                "quotes": [
                    "Working with Ryan was one of the most frustrating experiences I've had as an engineering lead.",
                    "He'd change the requirements mid-sprint and then blame us for not delivering.",
                    "I had engineers asking to be moved to different teams to avoid working with him.",
                ],
                "summary": "Tom gives a clearly negative assessment. Describes a pattern of poor collaboration, incomplete specifications, and mid-sprint priority changes that damaged team morale and trust.",
                "quality_status": "verified",
            },
            {
                "name": "Amanda Ross",
                "relation": "Product Design Partner",
                "scores": {"collaboration": 4, "technical_ability": 6, "reliability": 5, "communication": 5, "leadership": 3},
                "strengths": ["Has good product instincts", "Data-driven decision making"],
                "growth_areas": ["Doesn't involve design early enough", "Takes credit for team work", "Poor at giving and receiving feedback"],
                "recommendation": "no",
                "quotes": [
                    "Ryan would present our design work as his own ideas in leadership reviews.",
                    "I learned to send everything in writing because verbal agreements would be forgotten or reinterpreted.",
                    "He has potential, but he needs a lot of coaching on collaboration before he's ready to lead a product area.",
                ],
                "summary": "Amanda's assessment is negative. While she acknowledges Ryan's product instincts, she raises concerning patterns around credit-taking, unreliable agreements, and poor cross-functional collaboration.",
                "quality_status": "verified",
            },
            {
                "name": "Kevin Park",
                "relation": "Former Direct Report",
                "scores": {"collaboration": 0, "technical_ability": 0, "reliability": 0, "communication": 0, "leadership": 0},
                "strengths": [],
                "growth_areas": [],
                "recommendation": "",
                "quotes": [],
                "summary": "Reference declined consent for AI analysis.",
                "quality_status": "no_consent",
            },
        ],
        analysis_data={
            "discrepancies": [
                {
                    "dimension": "collaboration",
                    "detail": "All three references flag collaboration as a weakness, but the severity escalates: Lisa (5/10) sees it as a growth area, while Tom (3/10) and Amanda (4/10) describe it as actively harmful. Tom reports engineers requesting transfers to avoid Ryan.",
                    "severity": "major",
                },
                {
                    "dimension": "reliability",
                    "detail": "Lisa rates reliability 4/10 (missed deadlines), Tom rates it 3/10 (mid-sprint requirement changes blamed on engineering). A consistent pattern of unreliability across both management and cross-functional perspectives.",
                    "severity": "major",
                },
                {
                    "dimension": "leadership",
                    "detail": "Lisa hesitantly rates leadership 5/10. Tom (4/10) and Amanda (3/10) describe behaviors that actively undermine leadership credibility — blaming others and taking credit. Amanda explicitly says Ryan 'needs a lot of coaching' before leading.",
                    "severity": "major",
                },
            ],
            "overall_summary": "Ryan Cooper presents a concerning pattern across all three references. While acknowledged as analytically capable with good product instincts, every reference raises red flags about collaboration, reliability, and leadership maturity. The engineering lead's assessment is particularly alarming — describing damaged team morale and engineers requesting transfers. The consistency of negative signals across manager, engineering partner, and design partner makes this a clear no-hire recommendation.",
            "hire_recommendation": "no_hire",
            "confidence_score": 88,
        },
    )

    print("\nAll candidates seeded! Run: streamlit run dashboard.py")


if __name__ == "__main__":
    seed()
