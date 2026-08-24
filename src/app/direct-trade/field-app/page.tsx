import type { Metadata } from "next";
import Link from "next/link";

import { FieldAppDownload } from "@/components/FieldAppDownload";

export const metadata: Metadata = {
  title: "TLink Field app",
  description: "Install and update the TLink field app for technicians, trades and assessors.",
};

export default function FieldAppPage() {
  return <main className="tlink-field-app-page">
    <section className="tlink-field-app-hero">
      <div><span>TLink mobile</span><h1>Your day, your jobs, one clear field app</h1><p>TLink Field gives each technician, trade and assessor their own calendar, assigned jobs and step-by-step workflow forms. It is designed for one-handed use on site and keeps saved work available when reception drops.</p><div className="tlink-field-app-actions"><FieldAppDownload /><Link href="/direct-trade/dashboard">Back to TLink</Link></div></div>
      <div className="tlink-field-phone" aria-label="TLink Field schedule preview"><header><b>TL</b><span><small>MY SCHEDULE</small><br /><strong>Today</strong></span></header><div className="tlink-field-days"><i>M<em>24</em></i><i className="active">T<em>25</em></i><i>W<em>26</em></i><i>T<em>27</em></i><i>F<em>28</em></i></div><article><small>9:00 AM</small><strong>Rental property assessment</strong><span>4 workflows selected</span></article><article><small>1:30 PM</small><strong>Electrical safety check</strong><span>Electrical workflow only</span></article><button type="button" tabIndex={-1}>+</button></div>
    </section>
    <section className="tlink-field-app-grid">
      <article><span>01</span><strong>Get your name and PIN</strong><p>Your TLink administrator opens Team, chooses your name and creates a one-time field app PIN. No separate email account is needed.</p></article>
      <article><span>02</span><strong>Install on your phone</strong><p>Open this page on the Samsung or iPhone used for work, install the current test build, then enter the exact name and six-digit PIN.</p></article>
      <article><span>03</span><strong>Check for changes</strong><p>Open Account in TLink Field and choose Check for update. Small releases install in the app; full builds return here securely.</p></article>
    </section>
    <section className="tlink-field-app-note"><strong>Field access stays under business control</strong><p>Only assigned work is downloaded for an own-scope field worker. The business can revoke a lost phone, sign a worker out everywhere or replace an unused PIN from TLink Team.</p></section>
  </main>;
}
