'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { proxied, ApiError } from '@/lib/api';
import type { TaskSuggestion } from '@dial/schemas';
import {
  PlusIcon,
  PhoneCallIcon,
  MessageIcon,
  BriefcaseIcon,
  CalendarIcon,
  RefreshIcon,
  MapPinIcon,
  ClockIcon,
} from './icons';

/**
 * The command interface from the screenshot: centred hero line, a bordered
 * composer with an attach affordance on the left and a circular send button on
 * the right, and four suggestion cards beneath.
 */

/**
 * Shown to an account with nothing to go on yet. Everyone saw these forever,
 * including someone forty tasks in.
 */
const STARTERS = [
  { icon: MessageIcon, label: 'Find the cheapest iPhone repair near me' },
  { icon: BriefcaseIcon, label: 'Get three quotes for a plumber' },
  { icon: CalendarIcon, label: 'Book a dentist appointment this week' },
  { icon: RefreshIcon, label: 'Check if my prescription is ready' },
];

export function Composer({ defaultLocationLabel }: { defaultLocationLabel: string | null }) {
  const router = useRouter();
  const [instruction, setInstruction] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locationLabel, setLocationLabel] = useState(defaultLocationLabel);
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [history, setHistory] = useState<TaskSuggestion[] | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  /*
   * Loaded after paint rather than server-rendered: the composer is the first
   * thing anyone types into, and it must not wait on a history query to
   * appear. Failing quietly to the starters is the right failure here -- an
   * error banner about suggestions would be noise above the actual input.
   */
  useEffect(() => {
    let alive = true;
    proxied
      .getSuggestions(4)
      .then((response) => alive && setHistory(response.suggestions))
      .catch(() => alive && setHistory([]));
    return () => {
      alive = false;
    };
  }, []);

  async function useMyLocation() {
    if (!('geolocation' in navigator)) {
      setError('This browser cannot share your location. You can type a place instead.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        setCoords({ latitude, longitude });
        try {
          const resolved = await proxied.resolveLocation({ latitude, longitude });
          setLocationLabel(resolved.label);
        } catch {
          setLocationLabel('Your current location');
        }
        setLocating(false);
      },
      () => {
        // Denial is a normal answer, not an error state to shout about.
        setLocating(false);
        setError('Dial could not get your location. Type a city or postcode in your request instead.');
      },
      { enableHighAccuracy: false, timeout: 10_000 },
    );
  }

  async function submit() {
    const text = instruction.trim();
    if (!text || submitting) return;

    setSubmitting(true);
    setError(null);
    try {
      const task = await proxied.createTask({
        instruction: text,
        location: coords ? { ...coords, text: null } : locationLabel ? { latitude: null, longitude: null, text: locationLabel } : null,
        // Stable for this composition, so a double-submit cannot create two tasks.
        idempotencyKey: `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      });
      /*
       * Both, in this order.
       *
       * The recents list lives in the app layout, which is a server component.
       * Navigating to a child route does not re-render a layout, so a new task
       * did not appear in the sidebar until the page was reloaded by hand.
       * `refresh` re-runs the layout's own fetch against the server.
       */
      router.push(`/tasks/${task.id}`);
      router.refresh();
    } catch (caught) {
      const message =
        caught instanceof ApiError ? caught.message : 'Something went wrong. Please try again.';
      setError(message);
      setSubmitting(false);
    }
  }

  return (
    <div className="home">
      <h1 className="hero">Let Dial make the call for you</h1>

      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label htmlFor="instruction" className="visually-hidden">
          What do you want Dial to handle?
        </label>
        <textarea
          id="instruction"
          ref={textareaRef}
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void submit();
            }
          }}
          placeholder="Tell Dial what you need done and where"
          maxLength={2000}
          disabled={submitting}
        />

        <div className="composer-actions">
          <button
            type="button"
            className="icon-button"
            onClick={() => void useMyLocation()}
            disabled={locating}
            aria-label="Use my current location"
            title="Use my current location"
          >
            <PlusIcon size={20} />
          </button>

          <button
            type="submit"
            className="send-button"
            disabled={!instruction.trim() || submitting}
            aria-label="Start this task"
          >
            <PhoneCallIcon size={20} />
          </button>
        </div>
      </form>

      <div className="location-row">
        <MapPinIcon size={16} />
        {locating ? (
          <span>Finding your location…</span>
        ) : locationLabel ? (
          <>
            <span>Searching near {locationLabel}</span>
            <button type="button" className="link-button" onClick={() => void useMyLocation()}>
              change
            </button>
          </>
        ) : (
          <>
            <span>No location set — Dial will ask if it needs one.</span>
            <button type="button" className="link-button" onClick={() => void useMyLocation()}>
              use my location
            </button>
          </>
        )}
      </div>

      {error ? (
        <div className="notice" data-tone="danger" role="alert" style={{ marginTop: 16 }}>
          {error}
        </div>
      ) : null}

      {/*
        Your own finished tasks, offered back. Not a guess about what you
        might like -- one row per kind of thing you have actually asked for,
        carrying the most recent way you worded it.
      */}
      {history && history.length > 0 ? (
        <>
          <div className="suggestions-label">You have done this before</div>
          <div className="suggestions">
            {history.map((suggestion) => (
              <button
                key={suggestion.domain}
                type="button"
                className="suggestion"
                onClick={() => {
                  setInstruction(suggestion.instruction);
                  textareaRef.current?.focus();
                }}
              >
                <ClockIcon size={20} />
                <span className="suggestion-text">
                  <span className="suggestion-label">{suggestion.instruction}</span>
                  <span className="suggestion-meta">{describeUse(suggestion)}</span>
                </span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="suggestions">
          {STARTERS.map(({ icon: Icon, label }) => (
            <button
              key={label}
              type="button"
              className="suggestion"
              onClick={() => {
                setInstruction(label);
                textareaRef.current?.focus();
              }}
            >
              <Icon size={20} />
              <span className="suggestion-text">
                <span className="suggestion-label">{label}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * "Twice · last week, in Dublin 2" -- enough to recognise which of your own
 * tasks this is, without a timestamp nobody reads.
 */
function describeUse(suggestion: TaskSuggestion): string {
  const parts: string[] = [];
  if (suggestion.timesUsed > 1) parts.push(`${suggestion.timesUsed} times`);
  parts.push(relativeDay(suggestion.lastUsedAt));
  if (suggestion.locationLabel) parts.push(`in ${suggestion.locationLabel}`);
  return parts.join(' \u00B7 ');
}

function relativeDay(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (!Number.isFinite(days) || days < 0) return 'recently';
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 14) return 'last week';
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  return 'over a year ago';
}
