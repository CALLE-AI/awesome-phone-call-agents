/**
 * Read the open Gmail conversation out of the page.
 *
 * Gmail's markup is obfuscated and changes without notice, so every selector
 * here has fallbacks and the whole thing is written to fail loudly rather than
 * return a half-read thread. A thread we cannot read confidently is a thread we
 * refuse to act on: the alternative is proposing a phone call from a
 * misattributed message.
 *
 * Exposed as window.ConversationClarifyExtract so the same file can be loaded by
 * the content script and by the offline test page.
 */
(function (global) {
  'use strict';

  const MESSAGE_SELECTORS = ['div.adn.ads', 'div[role="listitem"].adn', 'div[data-message-id]'];
  const SENDER_SELECTORS = ['span.gD[email]', 'span[email][name]', 'span[email]'];
  const BODY_SELECTORS = ['div.a3s', 'div.ii.gt div[dir="ltr"]', 'div.ii.gt'];
  const SUBJECT_SELECTORS = ['h2.hP', 'h2[data-thread-perm-id]', 'h2.ha h2'];
  const DATE_SELECTORS = ['span.g3[title]', 'span[data-tooltip]', 'span.g3'];

  function first(root, selectors) {
    for (const selector of selectors) {
      const found = root.querySelector(selector);
      if (found) return found;
    }
    return null;
  }

  function all(root, selectors) {
    for (const selector of selectors) {
      const found = root.querySelectorAll(selector);
      if (found && found.length) return Array.from(found);
    }
    return [];
  }

  /**
   * The signed-in address, needed to tell "mine" from "theirs".
   * Without it we cannot attribute messages, so we do not guess.
   */
  function accountEmail(doc) {
    const labelled = doc.querySelector('a[aria-label*="@"], [aria-label*="Google Account"]');
    if (labelled) {
      const match = (labelled.getAttribute('aria-label') || '').match(/[\w.+-]+@[\w.-]+\.\w+/);
      if (match) return match[0].toLowerCase();
    }
    const meta = doc.querySelector('[data-account-email]');
    if (meta) return (meta.getAttribute('data-account-email') || '').toLowerCase();
    return '';
  }

  /** Visible text of a message body, with quoted history dropped. */
  function bodyText(element) {
    if (!element) return '';
    const clone = element.cloneNode(true);
    // Gmail wraps trimmed history in .gmail_quote / .adL and the "show trimmed
    // content" ellipsis in .ajR. None of it was typed in this message.
    clone.querySelectorAll('.gmail_quote, .adL, .ajR, blockquote').forEach((node) => node.remove());
    return normaliseWhitespace(clone.innerText || clone.textContent || '');
  }

  function normaliseWhitespace(text) {
    return text
      .replace(/ /g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  // Gmail collapses older messages behind a summary row, and a collapsed
  // message has no readable body. Reading a thread with half its messages
  // missing risks attributing a question to the wrong person, so expand first
  // and say so, rather than quietly analysing fragments.
  const EXPAND_ALL = [
    'div[role="button"][aria-label="Expand all"]',
    'span[role="button"][aria-label="Expand all"]',
    '[aria-label="Expand all"]',
    'div.ajT',                       // the "..." super-collapsed row
  ];

  /** The message blocks that have a readable body, in thread order.
   *  Same predicate readThread uses, so indexes line up between them. */
  function readableBlocks(doc) {
    return all(doc, MESSAGE_SELECTORS).filter((block) => {
      const body = first(block, BODY_SELECTORS);
      return body && (body.innerText || body.textContent || '').trim();
    });
  }

  function readableCount(doc) {
    return readableBlocks(doc).length;
  }

  /**
   * Bring a message into view. The finding is usually about the latest
   * exchange, which after expanding a long thread can be far below the fold.
   * Centred rather than at the bottom, because the panel sits bottom-right.
   */
  function scrollToMessage(doc, index) {
    const blocks = readableBlocks(doc);
    const target = blocks[index] || blocks[blocks.length - 1];
    if (!target || typeof target.scrollIntoView !== 'function') return false;

    const view = doc.defaultView || window;
    const reduced = view.matchMedia
      && view.matchMedia('(prefers-reduced-motion: reduce)').matches;

    try {
      target.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
    } catch (error) {
      target.scrollIntoView();          // older engines take no options
    }

    // Smooth scrolling is ignored outright by some engines and settings, and it
    // fails silently — the call returns, nothing moves, and the message stays
    // off screen. Check afterwards and jump instead of not scrolling at all.
    view.setTimeout(() => {
      const box = target.getBoundingClientRect();
      const offScreen = box.bottom < 0 || box.top > (view.innerHeight || 0);
      if (offScreen) target.scrollIntoView();
    }, 450);
    return true;
  }

  function clickExpandControls(doc) {
    for (const selector of EXPAND_ALL) {
      const control = doc.querySelector(selector);
      if (control) {
        try { control.click(); return true; } catch (error) { /* fall through */ }
      }
    }
    // No "expand all": open the collapsed blocks individually.
    let opened = false;
    all(doc, MESSAGE_SELECTORS).forEach((block) => {
      if (first(block, BODY_SELECTORS)) return;
      const header = block.querySelector('[role="heading"], .gE, .adn > div');
      if (header) {
        try { header.click(); opened = true; } catch (error) { /* ignore */ }
      }
    });
    return opened;
  }

  /**
   * Expand collapsed messages and wait for them to render.
   *
   * Clicking is not enough: Gmail renders expanded messages asynchronously and
   * older ones can require a fetch, so reading straight after the click can
   * still analyse fragments — while reporting that the thread was expanded,
   * which is worse than not expanding at all. Poll until the readable count
   * stops growing, then report messages gained rather than controls clicked.
   */
  async function expandAll(doc, options) {
    const settings = Object.assign(
      { timeoutMs: 6000, quietMs: 400, firstChangeMs: 2500 }, options || {});
    const before = readableCount(doc);
    if (!clickExpandControls(doc)) return { before, after: before, gained: 0 };

    const started = Date.now();
    const deadline = started + settings.timeoutMs;
    let last = before;
    let stableSince = started;
    let sawChange = false;

    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 120));
      const now = readableCount(doc);

      if (now !== last) {
        last = now;
        stableSince = Date.now();
        sawChange = true;
        continue;
      }
      // "Stable" only means something once something has actually happened.
      // Counting quiet time from the click declared the DOM settled before
      // Gmail had started rendering, and the thread was read in fragments.
      if (sawChange && Date.now() - stableSince >= settings.quietMs) break;
      if (!sawChange && Date.now() - started >= settings.firstChangeMs) break;
    }
    return { before, after: last, gained: Math.max(0, last - before) };
  }

  function threadIdFrom(doc) {
    const holder = doc.querySelector('[data-thread-perm-id]');
    if (holder) return holder.getAttribute('data-thread-perm-id');
    const match = (global.location && global.location.hash) || '';
    const tail = match.split('/').pop();
    return tail || '';
  }

  /**
   * @returns {{ok: boolean, reason?: string, thread?: object, warnings: string[]}}
   */
  function readThread(doc, options) {
    const warnings = [];
    const gained = (options && options.expandedCount) || 0;
    if (gained > 0) {
      warnings.push(
        `Expanded ${gained} collapsed message${gained === 1 ? '' : 's'} so the whole thread could be read.`
      );
    }
    const me = accountEmail(doc);
    if (!me) {
      return {
        ok: false,
        warnings,
        reason:
          'Cannot tell which account is signed in, so messages cannot be told apart. ' +
          'Open the thread in a normal Gmail tab, or paste the conversation instead.',
      };
    }

    const blocks = all(doc, MESSAGE_SELECTORS);
    if (!blocks.length) {
      return {
        ok: false,
        warnings,
        reason: 'No messages found on this page. Open a conversation first.',
      };
    }

    const messages = [];
    blocks.forEach((block, index) => {
      const senderEl = first(block, SENDER_SELECTORS);
      const bodyEl = first(block, BODY_SELECTORS);
      if (!bodyEl) {
        warnings.push(`Message ${index + 1} is collapsed or unreadable and was skipped.`);
        return;
      }
      const email = (senderEl && senderEl.getAttribute('email') || '').toLowerCase();
      const name = (senderEl && (senderEl.getAttribute('name') || senderEl.textContent) || '').trim();
      const dateEl = first(block, DATE_SELECTORS);

      const body = bodyText(bodyEl);
      if (!body) {
        warnings.push(`Message ${index + 1} had no readable text and was skipped.`);
        return;
      }

      messages.push({
        sender: name || email || 'Unknown',
        sender_email: email,
        from_me: Boolean(email) && email === me,
        body,
        sent_at: (dateEl && (dateEl.getAttribute('title') || dateEl.textContent) || '').trim(),
      });
    });

    if (messages.length < 2) {
      return {
        ok: false,
        warnings,
        reason:
          'Fewer than two readable messages here. Expand the collapsed ones and try again.',
      };
    }
    if (!messages.some((m) => m.from_me)) {
      return {
        ok: false,
        warnings,
        reason:
          'None of these messages appear to be from you. It only acts on a thread you are ' +
          'part of.',
      };
    }
    if (!messages.some((m) => !m.from_me)) {
      return { ok: false, warnings, reason: 'Nobody has replied to this thread yet.' };
    }

    const subjectEl = first(doc, SUBJECT_SELECTORS);
    return {
      ok: true,
      warnings,
      thread: {
        thread_id: threadIdFrom(doc),
        subject: (subjectEl && subjectEl.textContent || '').trim(),
        messages,
      },
    };
  }

  /**
   * Parse a manually pasted conversation. The escape hatch for when Gmail's
   * markup defeats the reader, and the only input path on the standalone page.
   *
   * Format, one block per message:
   *     Me: Does Monday or Tuesday work?
   *     Alex: Yeah, I'll be there.
   */
  function readPasted(text, subject) {
    const lines = String(text || '').split('\n');
    const messages = [];
    let current = null;

    for (const line of lines) {
      const match = line.match(/^\s*([A-Za-z][\w .'-]{0,40}):\s?(.*)$/);
      if (match) {
        if (current) messages.push(current);
        const who = match[1].trim();
        current = {
          sender: who,
          sender_email: '',
          from_me: /^(me|myself|i)$/i.test(who),
          body: match[2],
          sent_at: '',
        };
      } else if (current) {
        current.body += `\n${line}`;
      }
    }
    if (current) messages.push(current);
    messages.forEach((m) => { m.body = normaliseWhitespace(m.body); });

    const usable = messages.filter((m) => m.body);
    if (usable.length < 2) {
      return { ok: false, warnings: [], reason: 'Paste at least two messages, each starting with "Name: ".' };
    }
    if (!usable.some((m) => m.from_me)) {
      return { ok: false, warnings: [], reason: 'Label your own messages with "Me:" so they can be told apart.' };
    }
    if (!usable.some((m) => !m.from_me)) {
      return { ok: false, warnings: [], reason: 'Include at least one message from the other person.' };
    }
    return {
      ok: true,
      warnings: [],
      thread: { thread_id: 'pasted', subject: subject || '', messages: usable },
    };
  }

  global.ConversationClarifyExtract = {
    readThread, readPasted, bodyText, accountEmail, normaliseWhitespace, expandAll, readableCount, scrollToMessage,
  };
})(typeof window !== 'undefined' ? window : globalThis);
