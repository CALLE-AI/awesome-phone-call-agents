/* Presentation only. The server remains authoritative for offers, eligibility,
 * plan tokens and approval. No request, inferred capability or automatic retry
 * belongs in this module. Also exported for dependency-free Node tests. */
(function (root) {
  'use strict';
  const active = new Set(['queued', 'running', 'starting']);
  const list = value => Array.isArray(value) ? value : [];
  function observationOnly(run) {
    const needs = list(run.definition?.requirements);
    return needs.length > 0 && needs.every(n => n.id === 'scene_observation');
  }
  function contacts(run) {
    if (!run.definition || list(run.actions).length || !['covered', 'partial', 'stopped'].includes(run.status) ||
        ['call_limit', 'mode_changed', 'other_run_busy', 'review_required'].includes(run.continue_blocked_code) ||
        run.scope_warning || run.activity?.uncertain || run.legacy || run.engine_version < 3) return [];
    return list(run.contact_availability).filter(c =>
      (c.status === 'eligible' && run.can_continue) ||
      (c.status === 'no_capability_match' && run.can_check_unmatched));
  }
  function followups(run) {
    if (!run.definition || list(run.actions).length || !['covered','partial','stopped'].includes(run.status) ||
        !['', 'no_contacts', 'no_capability_match'].includes(run.continue_blocked_code || '') ||
        run.scope_warning || run.activity?.uncertain || run.legacy || run.engine_version < 3) return [];
    return list(run.followup_options);
  }
  function next(run) {
    const actions = list(run.actions), plans = list(run.plan_options);
    const chosen = plans.find(p => p.id === run.selected_plan_id);
    const result = (kind, title, body, action = '', label = '') => ({kind, title, body, action, label});
    if (run.provider_recovery && run.mode==='live' && ['failed','interrupted','attention','stopped'].includes(run.status) && !run.scope_warning && !run.legacy && run.engine_version>=3)
      return result('provider_recovery', run.provider_recovery.method==='read'?'Check the saved call':'Recover the original request', run.provider_recovery.explanation, 'recoverProvider', run.provider_recovery.label);
    // Unresolved provider state is not a safe invitation to place another call.
    if (run.activity?.uncertain && !active.has(run.status))
      return result('uncertain', 'Check the last call first', 'The provider has not confirmed how the last call ended. Review its saved status before arranging anything else.', 'reviewEvidence', 'Review the last call');
    if (active.has(run.status)) return result('working', '', '');
    if (run.status === 'completed')
      return result('completed', 'A safe place. A finished rescue.', '', 'shareUpdate', 'Copy a shareable update');
    if (actions.length) {
      if (run.status === 'attention' || actions.some(a => ['needs_attention', 'interrupted', 'skipped'].includes(a.status))) {
        const recovery = ['attention','stopped'].includes(run.status)&&!run.scope_warning&&!run.legacy&&run.engine_version>=3 ? run.callback_recovery : null;
        if (recovery) return result('recover', recovery.title, `${recovery.name}: ${recovery.reason}`, 'retryCallback', recovery.label);
        return result('attention', 'The callback needs review', 'Check the last reply before arranging more help.', 'reviewEvidence', 'View last reply');
      }
      if (run.status === 'active' && actions.every(a => a.progress === 'finished' || a.not_required) &&
          !list(run.plan?.requirements).some(n => n.gate_state === 'pending'))
        return result('close', 'Have the helpers finished?', 'Close this report only after you know the animal is safe.', 'completeRescue', 'Confirm the animal is safe');
      if (run.status === 'active' && !run.scope_warning && !run.legacy && run.engine_version >= 3 && list(run.decision_options).some(d => d.can_record))
        return result('assessment', 'Record the responder’s assessment', 'The complete goal is approved. Report the assigned helper’s result below; do not choose a branch from a guess.', 'reviewGoalConditions', 'View the conditional plan');
      return result('tracking', 'Help is confirmed', list(run.plan?.decisions).length ? 'Only the matching branch can proceed. Unused tasks stay inactive; update progress only from the helpers’ reports.' : '', '', '');
    }
    if (run.scope_warning)
      return result('scope', 'Review the requested help', 'The saved plan does not match your goal. Open a corrected draft before making more inquiries.', 'correctGoal', 'Review rescue goal');
    if (run.legacy || run.engine_version < 3)
      return result('legacy', 'This report needs a new review', 'Keep this history and review a new draft before arranging help.', 'correctGoal', 'Review a new draft');
    const blocked = run.continue_blocked_code;
    if (blocked === 'mode_changed')
      return result('mode', 'This report uses a different call mode', 'Your saved replies are unchanged. Check the app’s call settings before continuing.', 'openSettings', 'View call settings');
    if (blocked === 'other_run_busy')
      return result('busy', 'Another report is making an inquiry', 'Finish or stop that inquiry, then return to this report.', 'refreshAvailability', 'Refresh status');
    if (run.status === 'covered' && run.can_approve && chosen)
      return result('ready', 'A plan is ready to review', 'Choose the help that works for you.', 'startRescue', 'Review & approve');
    if (plans.length && run.status === 'covered')
      return result('choose_plan', 'Choose a plan to review', 'Choose a complete option to review.', 'comparePlans', 'Compare plans');
    if (followups(run).length) {
      const contact = followups(run)[0];
      const supervisor = list(contact.conditions).some(c => /supervisor/i.test(c));
      return result('condition', 'One confirmation before approval',
        supervisor ? `${contact.name} needs supervisor confirmation before they can offer help.` :
        `${contact.name} has an unresolved condition. Ask for a firm offer before approving a plan.`,
        'checkOfferCondition', supervisor ? 'Check supervisor confirmation' : 'Check the pending condition');
    }
    if (contacts(run).length) {
      const conditional = list(run.plan?.contact_offers).find(o => list(o.conditions).length);
      return result('find', run.status === 'stopped' ? 'Inquiries are stopped' : 'Nobody is confirmed yet',
        conditional ? `${conditional.name} has not confirmed they can help. Try another contact.` : 'The replies so far do not cover the requested help. You can ask another contact.',
        'chooseNextContact', 'Choose someone to ask');
    }
    if (blocked === 'no_contacts')
      return result('add', 'Add someone else to ask', 'No confirmed offer yet. Add another trusted person who may be able to help.', 'addCompareContact', 'Add a trusted contact');
    if (blocked === 'call_limit')
      return result('limit', 'This report has reached its call limit', 'Your replies are saved. Adding a contact will not restart inquiries for this run.', 'reviewEvidence', 'Review saved replies');
    return result('review', 'Review what happened', 'Your report and replies are saved. Review the latest update to continue.', 'reviewEvidence', 'Review saved replies');
  }
  const api = Object.freeze({next, contacts, followups, observationOnly});
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RescueFlow = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
