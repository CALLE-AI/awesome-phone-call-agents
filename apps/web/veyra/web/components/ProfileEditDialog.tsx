"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { MAX_PROFILE_IMAGE_BYTES } from "@/lib/profile";

export default function ProfileEditDialog({
  fullName,
  companyName,
  email,
  avatarUrl,
  initials,
}: {
  fullName: string | null;
  companyName: string | null;
  email: string | null;
  avatarUrl: string | null;
  initials: string;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(fullName ?? "");
  const [company, setCompany] = useState(companyName ?? "");
  const [avatar, setAvatar] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [removeAvatar, setRemoveAvatar] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () => () => {
      if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    },
    [avatarPreview],
  );

  const open = () => {
    setName(fullName ?? "");
    setCompany(companyName ?? "");
    setAvatar(null);
    setAvatarPreview(null);
    setRemoveAvatar(false);
    setError(null);
    if (fileInput.current) fileInput.current.value = "";
    dialog.current?.showModal();
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);

    const body = new FormData();
    body.set("fullName", name);
    body.set("companyName", company);
    if (avatar) body.set("avatar", avatar);
    if (removeAvatar) body.set("removeAvatar", "true");

    try {
      const response = await fetch("/api/profile", { method: "PATCH", body });
      const result: unknown = await response.json();
      if (!response.ok) {
        const message =
          typeof result === "object" &&
          result !== null &&
          "error" in result &&
          typeof result.error === "string"
            ? result.error
            : "Profile could not be updated";
        throw new Error(message);
      }
      dialog.current?.close();
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Profile could not be updated");
    } finally {
      setSaving(false);
    }
  };

  const shownAvatar = removeAvatar ? null : avatarPreview ?? avatarUrl;

  return (
    <>
      <button
        type="button"
        onClick={open}
        className="cursor-pointer border border-bone/[.26] bg-transparent px-[17px] py-3 text-[13.5px] font-extrabold text-bone hover:bg-bone/[.07]"
      >
        Edit profile
      </button>

      <dialog
        ref={dialog}
        aria-labelledby="profile-dialog-title"
        onCancel={(event) => {
          if (saving) event.preventDefault();
        }}
        onClick={(event) => {
          if (!saving && event.target === event.currentTarget) dialog.current?.close();
        }}
        className="m-auto w-[min(92vw,560px)] border border-bone/[.3] bg-panel p-0 text-bone shadow-2xl backdrop:bg-black/75"
      >
        <form onSubmit={submit} className="p-6">
          <div className="mb-6 flex items-start justify-between gap-4 border-b border-bone/[.18] pb-4">
            <div>
              <div className="text-[10.5px] uppercase tracking-[.14em] text-ember">Account</div>
              <h2 id="profile-dialog-title" className="mt-1 text-2xl font-extrabold tracking-[-.02em]">
                Edit profile
              </h2>
            </div>
            <button
              type="button"
              onClick={() => dialog.current?.close()}
              disabled={saving}
              aria-label="Close profile dialog"
              className="cursor-pointer border-0 bg-transparent p-1 text-xl text-bone/45 hover:text-bone disabled:cursor-not-allowed"
            >
              ×
            </button>
          </div>

          <div className="mb-6 flex flex-wrap items-center gap-4">
            <span
              role="img"
              aria-label="Profile image preview"
              className="grid size-20 flex-none place-items-center border border-bone/[.26] bg-bone/10 bg-cover bg-center text-xl font-extrabold"
              style={shownAvatar ? { backgroundImage: `url(${shownAvatar})` } : undefined}
            >
              {shownAvatar ? null : initials}
            </span>
            <div className="flex flex-wrap gap-2">
              <label className="cursor-pointer border border-bone/[.26] px-3.5 py-[9px] text-[12.5px] font-extrabold hover:bg-bone/[.07]">
                Choose image
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="sr-only"
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null;
                    if (file && file.size > MAX_PROFILE_IMAGE_BYTES) {
                      event.target.value = "";
                      setAvatar(null);
                      setAvatarPreview(null);
                      setRemoveAvatar(false);
                      setError("Profile image must be 2 MB or smaller");
                      return;
                    }
                    setError(null);
                    setAvatar(file);
                    setAvatarPreview(file ? URL.createObjectURL(file) : null);
                    setRemoveAvatar(false);
                  }}
                />
              </label>
              {avatarUrl || avatar ? (
                <button
                  type="button"
                  onClick={() => {
                    setAvatar(null);
                    setAvatarPreview(null);
                    setRemoveAvatar(true);
                    if (fileInput.current) fileInput.current.value = "";
                  }}
                  className="cursor-pointer border border-red-300/35 bg-transparent px-3.5 py-[9px] text-[12.5px] font-extrabold text-red-200 hover:bg-red-950/30"
                >
                  Remove image
                </button>
              ) : null}
            </div>
            <p className="w-full text-xs leading-5 text-bone/40">
              PNG, JPEG, or WebP. Maximum 2 MB. Images are private to your account.
            </p>
          </div>

          <div className="grid gap-4">
            <label className="text-xs text-bone/55">
              <span className="mb-2 block font-extrabold uppercase tracking-[.1em] text-bone/65">
                Full name
              </span>
              <input
                required
                maxLength={120}
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="w-full border border-bone/[.26] bg-ink px-3.5 py-3 text-sm text-bone outline-none focus:border-flame"
              />
            </label>
            <label className="text-xs text-bone/55">
              <span className="mb-2 block font-extrabold uppercase tracking-[.1em] text-bone/65">
                Company
              </span>
              <input
                maxLength={120}
                value={company}
                onChange={(event) => setCompany(event.target.value)}
                placeholder="Optional"
                className="w-full border border-bone/[.26] bg-ink px-3.5 py-3 text-sm text-bone outline-none focus:border-flame"
              />
            </label>
            <label className="text-xs text-bone/55">
              <span className="mb-2 block font-extrabold uppercase tracking-[.1em] text-bone/65">
                Email
              </span>
              <input
                value={email ?? ""}
                disabled
                className="w-full border border-bone/[.18] bg-ink px-3.5 py-3 text-sm text-bone/40 outline-none"
              />
              <span className="mt-2 block text-bone/35">Sign-in email cannot be changed here.</span>
            </label>
          </div>

          {error ? (
            <div role="alert" className="mt-5 border border-red-400/50 bg-red-950/30 p-3 text-sm text-red-200">
              {error}
            </div>
          ) : null}

          <div className="mt-6 flex justify-end gap-3 border-t border-bone/[.18] pt-4">
            <button
              type="button"
              onClick={() => dialog.current?.close()}
              disabled={saving}
              className="cursor-pointer border border-bone/[.26] bg-transparent px-4 py-2.5 text-sm font-extrabold text-bone disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="cursor-pointer border-0 bg-flame px-4 py-2.5 text-sm font-extrabold text-ink disabled:cursor-wait disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
