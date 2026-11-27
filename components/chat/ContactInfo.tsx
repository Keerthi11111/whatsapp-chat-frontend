"use client";

import { useState } from "react";
import { AtSign, Mail, Phone, X } from "lucide-react";
import Avatar from "@/components/Avatar";
import { photoUrl, type Contact } from "@/services/auth";
import { formatLastSeen } from "./types";

type ContactInfoProps = {
  contact: Contact;
  /** My own chat ("Message yourself"): no online / last seen line. */
  isSelf?: boolean;
  onClose: () => void;
};

/** Side panel like WhatsApp's "Contact info": big photo, name, email. */
export default function ContactInfo({ contact, isSelf = false, onClose }: ContactInfoProps) {
  const [viewingPhoto, setViewingPhoto] = useState(false);
  const src = photoUrl(contact.profileImage);

  return (
    <aside className="absolute inset-0 z-20 flex flex-col bg-[#f0f2f5] md:static md:w-[340px] md:shrink-0 md:border-l md:border-[#d1d7db]">
      <div className="flex items-center gap-3 h-[59px] shrink-0 bg-[#f0f2f5] px-4">
        <button onClick={onClose} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Close contact info">
          <X className="h-5 w-5" />
        </button>
        <h2 className="text-base text-[#111b21]">Contact info</h2>
      </div>

      <div className="flex flex-col items-center bg-white px-6 pb-6 pt-8 text-center shadow-[0_1px_3px_rgba(11,20,26,.08)]">
        <button
          type="button"
          onClick={() => src && setViewingPhoto(true)}
          className={src ? "cursor-zoom-in rounded-full" : "cursor-default rounded-full"}
          aria-label={src ? "View profile photo" : undefined}
        >
          <Avatar name={contact.name} image={contact.profileImage} seed={contact.id} className="h-40 w-40 text-5xl shadow-lg" />
        </button>
        <h3 className="mt-4 text-2xl text-[#111b21]">{contact.name}</h3>
        {contact.username && <p className="mt-1 text-slate-500">@{contact.username}</p>}
        {contact.phone && <p className="mt-0.5 text-sm text-slate-500">{contact.phone}</p>}
        {!isSelf && (contact.isOnline || contact.lastSeenAt) && (
          <p className={`mt-1 text-sm ${contact.isOnline ? "text-[#1fa855]" : "text-[#667781]"}`}>
            {contact.isOnline ? "online" : formatLastSeen(contact.lastSeenAt!)}
          </p>
        )}
      </div>

      <div className="mt-2.5 divide-y divide-[#e9edef] bg-white shadow-[0_1px_3px_rgba(11,20,26,.08)]">
        {[
          { label: "Username", value: contact.username && `@${contact.username}`, icon: AtSign },
          { label: "Phone", value: contact.phone, icon: Phone },
          { label: "Email", value: contact.email, icon: Mail },
        ]
          .filter((row) => row.value)
          .map(({ label, value, icon: Icon }) => (
            <div key={label} className="px-6 py-4">
              <p className="text-sm text-[#667781]">{label}</p>
              <p className="mt-1 flex items-center gap-2 text-sm text-slate-800">
                <Icon className="h-4 w-4 text-[#00a884]" />
                {value}
              </p>
            </div>
          ))}
      </div>

      {viewingPhoto && src && (
        <div className="fixed inset-0 z-50 flex flex-col bg-slate-950/95" onClick={() => setViewingPhoto(false)}>
          <div className="flex items-center gap-3 p-4 text-white">
            <Avatar name={contact.name} image={contact.profileImage} seed={contact.id} className="h-10 w-10 text-sm" />
            <span className="flex-1 font-medium">{contact.name}</span>
            <button className="rounded-lg p-2 hover:bg-white/10" aria-label="Close photo">
              <X className="h-6 w-6" />
            </button>
          </div>
          <div className="flex flex-1 items-center justify-center p-4">
            {/* eslint-disable-next-line @next/next/no-img-element -- photo served by our backend */}
            <img src={src} alt={contact.name} className="max-h-full max-w-full rounded-lg object-contain" onClick={(e) => e.stopPropagation()} />
          </div>
        </div>
      )}
    </aside>
  );
}
