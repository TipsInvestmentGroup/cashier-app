---
name: daily-cashier-report
description: Generate a daily cashier report for Tips Investment Limited (or any company using the same multi-tenant template) — reconciles collection/sales against system sales, groups signed bills by category (Director, Admin, Customer, Tips/Dancer/DJ, Staff losses) then auto-sums by person, plus paid bills, cancellations, discounts, petty cash, and cash-in-hand. Use this whenever asked to generate, produce, build, or update a "daily cashier report", "cashier report", "today's cashier report", or an outlet's end-of-day cashier reconciliation — even if the user just pastes raw sales/bills numbers, attaches an Excel/Mypos/PDF export, or asks for "today's numbers written up" without naming the report explicitly.
---

<!-- SYNC: mirror of the invokable Claude skill at claude-skills/daily-cashier-report/SKILL.md -->
> **Keep in sync.** This is a mirror of the invokable Claude skill at
> `claude-skills/daily-cashier-report/SKILL.md`. It lives in the repo so the
> template travels with the app it mirrors — the app's report
> (`app/daily-report/page.tsx` plus the `cdr-*` styles in `app/globals.css`) is
> meant to look identical to this template. **If you edit either copy — this doc
> or the skill — apply the same change to the other.**

## Daily cashier report — Tips Investment Limited (multi-tenant template)

This skill produces the daily cashier report used by Tips Investment Limited's outlets (Mikocheni, Coco, Tips Outside), built from the real Mikocheni Outlet, 17 Jul 2026 report and refined through several rounds of review with the business owner (John John). The template is company-agnostic: a new company just gets its own `COMPANY_CONFIG`.

### What the report contains, in order
1. **Header** — company logo/name/address (from `COMPANY_CONFIG`, position left/center/right), outlet, date, cashier name, a reference code (`{COMPANY-SHORTCODE}-{OUTLET-SHORTCODE}-{YYYYMMDD}`).
2. **Collection (sales)** — System Sales is shown as a *reference* line, separate from the grid of payment channels (Cash, CRDB, Stanbic, M-Pesa, CRDB Lipa Hapa) that actually sum to Total Collected. Variance (`collected − system sales`) is shown as its own derived line below the total, not as a peer of the summable channels. Keeping System Sales and Variance visually separate from the summable channels matters — mixing them in one grid implies they should be added together, which they should not.
3. **Signed bills** — grouped by category in this fixed order: Director bills, Admin bills, Customer bills, Tips/dancer/DJ bills, Staff bills (losses). Within each category, group by the **signer's name** and sum all their bills into one line; if a signer has more than one bill, show a small "(N bills)" tag and list the full recipient breakdown in a "Multi-recipient breakdown" appendix at the end of the section (so the report stays compact but no audit detail is lost). Category → source `TYPE` field mapping: `Director` → Director bills, `Admin` → Admin bills, `Customer` → Customer bills, `Tips` (including meeting hosts, DJs, dancers) → Tips/dancer/DJ bills, `Staff Loss` → Staff bills (losses). Staff bills (losses) should never be compressed/hidden regardless of how small the amount — these are individual accountability records tied to loss write-offs and HR follow-up, so every one stays fully visible as its own line.
4. **Paid bills (debts collected)** — same category structure as signed bills but without a Tips category (tips aren't debts), and each line shows the payment method (Cash / Bank transfer / etc.) instead of a recipient breakdown.
5. **Cancellations** — flat list of product + quantity + amount.
6. **Discounts** — flat list of customer + reason + amount. (Not present in Tips Investment's original paper-era report — added because the business wants to start tracking it. If a given day has none, show "No discounts" rather than omitting the section.)
7. **Petty cash / expenses** — flat list of expense description + amount.
8. **Summary** — "Approved petty cash paid out" (= sum of petty cash entries) then "Cash in hand" = Cash (from Collection) − petty cash paid out. **Open question, not yet resolved with finance**: paid bills collected in cash, and any cash effect of cancellations/discounts, are NOT currently netted into Cash in hand. Ask the user/finance before changing this — don't assume either way.

### Density rules (why the layout looks the way it does)
- Every list (signed bills within a category, paid bills within a category, cancellations, discounts, petty cash) renders as a 4-column grid (`ledger-cols`/`ledger-item`), not one full-width row per entry. This is what lets a category with 30+ people still read compactly. Never truncate a name to save space — wrap it instead.
- The whole report should fit one printed page for a normal day. It won't always fit for very high-volume days (many categories at once with 20-30+ people each) — that's a real print-page limit, not a bug. The template includes a live "fits on one page / spills to N pages" check in the footer (`checkFit()` in the script) so whoever runs the system can see this rather than assume it.
- If a day's data genuinely doesn't fit one page, let it spill to a second page rather than shrinking font below readability or hiding entries.

### How to build a report from raw input
1. Get the day's raw data (pasted numbers, an attached Excel/Mypos export, or a PDF like the original cashier report format). Extract: outlet, date, cashier name, the 5 collection channels + system sales, every signed bill (signer, recipient, type, amount), every paid bill (debtor, method, amount), cancellations (product, qty, amount), discounts (customer, reason, amount), petty cash (description, amount).
2. Group signed bills and paid bills by signer/debtor name, summing amounts, per the category mapping above.
3. Fill in `REPORT_DATA` and (if this is a new company) `COMPANY_CONFIG` in the template below.
4. Save the filled-in HTML file (e.g. `cashier-daily-report-{outlet}-{date}.html`), open/verify it, and present it to the user. If they need a PDF, use the pdf skill to convert this HTML to PDF (print-to-PDF at A4, since the template already has print-specific styling that strips shadows and hides nothing but keeps borders).
5. Point out anything that doesn't cleanly fit the category rules above (e.g. a bill type that isn't Director/Admin/Customer/Tips/Staff Loss) instead of guessing where it goes.

### Self-contained template (fill in `COMPANY_CONFIG` and `REPORT_DATA`, everything else is computed automatically)

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cashier Daily Report</title>
<style>
  /*
    PRODUCTION TEMPLATE — cashier daily report.
    Replace COMPANY_CONFIG and REPORT_DATA below with the real company
    settings and the day's real figures. Everything else (layout, totals,
    grouping) is computed from those two objects.
  */
  :root{
    --bg:#e9edf3;
    --light:#ffffff;
    --dark:#c1c9d6;
    --ink:#3a4152;
    --ink-soft:#525a70;
    --ink-mid:#565f78;
    --accent:#5b4fd6;
    --raised: 8px 8px 16px var(--dark), -8px -8px 16px var(--light);
    --raised-sm: 4px 4px 10px var(--dark), -4px -4px 10px var(--light);
    --pressed: inset 4px 4px 8px var(--dark), inset -4px -4px 8px var(--light);
    --radius: 20px;
  }
  *{box-sizing:border-box;}
  body{
    margin:0; padding:32px 16px 64px; background:var(--bg);
    font-family:-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
    color:var(--ink);
  }
  .wrap{max-width:760px;margin:0 auto;}
  .panel{
    background:var(--bg); border-radius:var(--radius);
    box-shadow:var(--raised); padding:20px 24px;
  }
  .logo-badge{
    width:56px; height:56px; border-radius:16px; background:var(--bg);
    box-shadow:var(--raised-sm); display:flex; align-items:center; justify-content:center;
    font-weight:700; color:var(--accent); font-size:15px; flex-shrink:0; overflow:hidden;
  }
  .logo-badge img{width:100%; height:100%; object-fit:cover;}

  .report-header{padding-bottom:18px; margin-bottom:18px; border-bottom:1px solid var(--dark);}
  .header-top{display:flex; align-items:center; gap:14px; margin-bottom:16px;}
  .header-top.pos-left{justify-content:flex-start;}
  .header-top.pos-center{justify-content:center; text-align:center; flex-direction:column;}
  .header-top.pos-right{justify-content:flex-end; flex-direction:row-reverse;}
  .company-name{font-size:17px; font-weight:700; color:var(--ink);}
  .company-addr{font-size:12px; color:var(--ink-soft); margin-top:2px;}
  .report-meta{display:flex; justify-content:space-between; align-items:flex-end; flex-wrap:wrap; gap:8px;}
  .report-title{font-size:20px; font-weight:700; color:var(--ink); margin:0;}
  .report-sub{font-size:12px; color:var(--ink-soft); margin-top:2px;}
  .report-right{text-align:right; font-size:12px; color:var(--ink-soft); line-height:1.6;}
  .report-ref{font-size:11px; color:var(--ink-soft);}

  .section{margin-bottom:20px;}
  .section-title{
    font-size:12px; font-weight:700; letter-spacing:.04em; text-transform:uppercase;
    color:var(--accent); margin:0 0 10px; display:flex; justify-content:space-between;
  }
  .category{margin-bottom:12px;}
  .category-title{
    display:flex; align-items:center; justify-content:space-between;
    font-size:12.5px; font-weight:700; color:var(--ink); margin:0 2px 5px;
  }
  .category-title .name{display:flex; align-items:center; gap:8px;}
  .category-title .dot{width:8px; height:8px; border-radius:50%; flex-shrink:0; print-color-adjust:exact; -webkit-print-color-adjust:exact;}
  .category-title .subtotal{font-variant-numeric:tabular-nums; color:var(--ink-soft); font-weight:600;}
  .row{
    display:flex; justify-content:space-between; align-items:baseline;
    padding:8px 14px; border-radius:12px; margin-bottom:5px;
    background:var(--bg); box-shadow:var(--pressed);
  }
  .row .label{font-size:13.5px;}
  .row .amount{font-size:13.5px; font-weight:600; font-variant-numeric:tabular-nums;}
  .row .amount.neg{color:#c0392b;}
  .ref-line{
    display:flex; justify-content:space-between; align-items:center;
    padding:8px 14px; border-radius:12px; margin-bottom:10px;
    border:1px dashed var(--dark); font-size:12.5px; color:var(--ink-soft);
  }
  .ref-line b{color:var(--ink); font-weight:600; font-variant-numeric:tabular-nums;}
  .collection-grid{
    display:grid; grid-template-columns:repeat(5, 1fr); gap:10px; margin-bottom:10px;
  }
  .collection-grid .cell{
    background:var(--bg); box-shadow:var(--pressed); border-radius:12px; padding:10px 12px;
  }
  .collection-grid .cell .label{font-size:11px; color:var(--ink-soft); margin-bottom:4px;}
  .collection-grid .cell .amount{font-size:14px; font-weight:600; font-variant-numeric:tabular-nums;}
  .collection-grid .cell .amount.neg{color:#c0392b;}
  @media (max-width:680px){ .collection-grid{grid-template-columns:repeat(3, 1fr);} }
  @media (max-width:420px){ .collection-grid{grid-template-columns:repeat(2, 1fr);} }
  .variance-row{
    display:flex; justify-content:space-between; align-items:baseline;
    padding:6px 14px 12px; font-size:12.5px; color:var(--ink-soft);
  }
  .variance-row .amount{font-weight:600; font-variant-numeric:tabular-nums;}
  .variance-row .amount.neg{color:#c0392b;}
  .total-row{
    display:flex; justify-content:space-between; padding:12px 14px; border-radius:12px;
    background:var(--bg); box-shadow:var(--raised-sm); font-weight:700; font-size:13.5px;
    color:var(--accent);
  }
  .summary-row.grand{
    background:var(--accent); color:#fff; box-shadow:var(--raised-sm);
    print-color-adjust:exact; -webkit-print-color-adjust:exact;
  }
  .footer{text-align:center; font-size:11px; color:var(--ink-soft); margin-top:14px;}
  .footer .fit-note{margin-top:4px; font-size:10px;}

  .ledger-cols{ display:grid; grid-template-columns:repeat(4, 1fr); gap:2px 16px; margin-bottom:4px; }
  @media (max-width:680px){ .ledger-cols{grid-template-columns:repeat(3, 1fr);} }
  @media (max-width:420px){ .ledger-cols{grid-template-columns:repeat(2, 1fr);} }
  .ledger-item{
    display:flex; justify-content:space-between; align-items:baseline; gap:8px;
    padding:3px 2px; border-bottom:1px solid var(--dark); font-size:11.5px;
    break-inside:avoid;
  }
  .ledger-item .lname{line-height:1.25;}
  .ledger-item .lamt{font-weight:600; font-variant-numeric:tabular-nums; flex-shrink:0; white-space:nowrap;}
  .ledger-item .multi{font-size:9.5px; color:var(--ink-soft); margin-left:3px; font-weight:400;}

  .appendix{
    margin-top:8px; padding:10px 14px; border-radius:12px;
    background:var(--bg); box-shadow:var(--pressed); font-size:10.5px; color:var(--ink-mid); line-height:1.7;
  }
  .appendix .a-title{font-size:10.5px; font-weight:700; color:var(--ink-soft); text-transform:uppercase; letter-spacing:.03em; margin-bottom:5px;}
  .appendix .a-entry b{color:var(--ink);}

  @media print{
    body{background:#fff; padding:0;}
    .wrap{max-width:100%;}
    .panel{box-shadow:none; border:1px solid #d5d9e0;}
    .row, .collection-grid .cell, .total-row, .ref-line, .appendix{
      box-shadow:none; border:1px solid #d5d9e0;
    }
  }
</style>
</head>
<body>
<div class="wrap">
  <main class="panel" id="reportCard">
    <div id="reportContent">
      <header class="report-header">
        <div class="header-top" id="headerTop">
          <div class="logo-badge" id="logoBadge"></div>
          <div>
            <div class="company-name" id="companyName"></div>
            <div class="company-addr" id="companyAddr"></div>
          </div>
        </div>
        <div class="report-meta">
          <div>
            <h1 class="report-title">Cashier daily report</h1>
            <div class="report-sub" id="cashierName"></div>
          </div>
          <div class="report-right">
            <span id="outletName"></span><br>
            <span id="reportDate"></span><br>
            <span class="report-ref" id="reportRef"></span>
          </div>
        </div>
      </header>

      <section class="section">
        <h2 class="section-title"><span>Collection (sales)</span><span>TSh</span></h2>
        <div class="ref-line"><span>System sales (per POS, for comparison only)</span><b id="systemSalesAmt">0</b></div>
        <div class="collection-grid" id="collectionGrid"></div>
        <div class="total-row" id="collectedTotalRow"><span>Total collected</span><span>0</span></div>
        <div class="variance-row" id="varianceRow"><span>Variance (collected − system sales)</span><span class="amount">0</span></div>
      </section>

      <section class="section" id="signedBillsSection">
        <h2 class="section-title"><span>Signed bills — by category, then by person</span><span>TSh</span></h2>
        <div id="categoriesHost"></div>
        <div class="total-row" id="grandTotalRow"><span>Total signed bills</span><span>0</span></div>
        <div class="appendix" id="appendixHost" style="display:none;">
          <div class="a-title">Multi-recipient breakdown</div>
          <div id="appendixList"></div>
        </div>
      </section>

      <section class="section">
        <h2 class="section-title"><span>Paid bills (debts collected)</span><span>TSh</span></h2>
        <div id="paidHost"></div>
        <div class="total-row" id="paidTotalRow"><span>Total paid bills</span><span>0</span></div>
      </section>

      <section class="section">
        <h2 class="section-title"><span>Cancellations</span><span>TSh</span></h2>
        <div id="cancellationsHost"></div>
        <div class="total-row" id="cancellationsTotalRow"><span>Total cancellations</span><span>0</span></div>
      </section>

      <section class="section">
        <h2 class="section-title"><span>Discounts</span><span>TSh</span></h2>
        <div id="discountsHost"></div>
        <div class="total-row" id="discountsTotalRow"><span>Total discounts</span><span>0</span></div>
      </section>

      <section class="section">
        <h2 class="section-title"><span>Petty cash / expenses</span><span>TSh</span></h2>
        <div id="pettyHost"></div>
        <div class="total-row" id="pettyTotalRow"><span>Total petty cash</span><span>0</span></div>
      </section>

      <section class="section">
        <div class="row" id="pettyPaidOutRow"><span class="label">Approved petty cash paid out</span><span class="amount" id="pettyPaidOutAmt">0</span></div>
        <div class="row summary-row grand"><span>Cash in hand</span><span id="cashInHandAmt">0</span></div>
      </section>

      <div class="footer">
        <div id="generatedLine"></div>
        <div class="fit-note" id="fitNote"></div>
      </div>
    </div>
  </main>
</div>

<script>
  /* ============================================================
     1) COMPANY_CONFIG — set once per company (multi-tenant).
        Populate from the company's settings record (logo, name,
        address, preferred logo position).
     ============================================================ */
  var COMPANY_CONFIG = {
    name: 'Tips Investment Limited',
    address: 'Mikocheni, Dar es Salaam, Tanzania',
    logoText: 'TIPS',      // fallback initials/text if no logo image is set
    logoImageUrl: '',      // if set, this image is used instead of logoText
    logoPosition: 'center', // 'left' | 'center' | 'right'
    currency: 'TSh'        // unit prefixed to every amount (matches the app's formatCurrency)
  };

  /* ============================================================
     2) REPORT_DATA — the day's actual figures. Replace with the
        real day's data. The example below is the real Mikocheni
        Outlet, 17 Jul 2026 report, kept as a working reference.
     ============================================================ */
  var REPORT_DATA = {
    outlet: 'Mikocheni Outlet',
    date: 'Friday, 17 Jul 2026',
    cashier: 'Janeth Ngonepo',
    ref: 'TIPS-MKC-20260717',
    generatedAt: '04 Aug 2026 16:24',

    collection: {
      systemSales: 11497000,
      cash: 1029000,
      crdb: 2741000,
      stanbic: 0,
      mpesa: 0,
      crdbLipaHapa: 5181000
    },

    signed: {
      director: [
        {name:'Isack', details:[{who:'Jazila Maurid',amt:412000},{who:'Anitha Alex',amt:148000},{who:'Glory Limo',amt:4000}]},
        {name:'Muro', details:[{who:'Amina',amt:315000},{who:'Beatrice',amt:82000},{who:'Jazila Maurid',amt:7000},{who:'Shukrani',amt:4000},{who:'Matha Rajabu',amt:2000}]},
        {name:'Patrick', details:[{who:'Nango',amt:324000},{who:'Shukrani',amt:2000}]}
      ],
      admin: [
        {name:'Ramadhani Manager', details:[{who:'Mary New Employee',amt:38000},{who:'Shakira',amt:20000}]},
        {name:'Phina', details:[{who:'Stella Kidimbwi',amt:20000},{who:'Cleopatra',amt:4000}]},
        {name:'Sia Mkama', details:[{who:'Vero Meshack',amt:20000},{who:'Diana',amt:2000}]},
        {name:'Ronald', details:[{who:'Diana',amt:6000},{who:'Jazila Maurid',amt:2000}]},
        {name:'Joseph Supervispr', details:[{who:'Cleopatra',amt:12000}]},
        {name:'Betson', details:[{who:'Shukrani',amt:12000}]},
        {name:'Janeth', details:[{who:'Jaffari',amt:6000}]},
        {name:'John John', details:[{who:'Shukrani',amt:2000}]},
        {name:'Sunday', details:[{who:'Glory Limo',amt:2000}]}
      ],
      customer: [
        {name:'Francis Customer', details:[{who:'Beatrice',amt:208000}]}
      ],
      tips: [
        {name:'ZNZ Meeting', details:[{who:'Anitha Alex',amt:564000}]},
        {name:'Dancer', details:[{who:'Mary New Employee',amt:20000},{who:'Amina',amt:20000}]},
        {name:'DJ', details:[{who:'Beatrice',amt:36000}]}
      ],
      staff: [
        {name:'Jaffari', details:[{who:'Jaffari',amt:160000}]},
        {name:'Amina', details:[{who:'Amina',amt:50000}]},
        {name:'Shukrani', details:[{who:'Shukrani',amt:12000}]}
      ]
    },

    paid: {director:[], admin:[], customer:[], staff:[]},
    cancellations: [
      {label:'Victor Rose 20cl', tag:'qty 1', amount:50000}
    ],
    discounts: [],
    pettyCash: []
  };

  /* ============================================================
     Rendering engine below this line is generic — it does not
     need to change per company or per day, only the two objects
     above do.
     ============================================================ */

  function fmt(n){ return (COMPANY_CONFIG.currency || 'TSh') + ' ' + n.toLocaleString('en-US'); }

  var CATEGORY_META = [
    {key:'director', label:'Director bills', color:'#5b4fd6'},
    {key:'admin', label:'Admin bills', color:'#6b7386'},
    {key:'customer', label:'Customer bills', color:'#2f9e83'},
    {key:'tips', label:'Tips, dancer & DJ bills', color:'#c9822f'},
    {key:'staff', label:'Staff bills (losses)', color:'#c0392b'}
  ];

  var PAID_CATEGORY_META = [
    {key:'director', label:'Director', color:'#5b4fd6'},
    {key:'admin', label:'Admin', color:'#6b7386'},
    {key:'customer', label:'Customer', color:'#2f9e83'},
    {key:'staff', label:'Staff', color:'#c0392b'}
  ];

  function total(entry){ return entry.details.reduce(function(s,d){ return s + d.amt; }, 0); }

  function renderCompanyHeader(){
    document.getElementById('headerTop').className = 'header-top pos-' + (COMPANY_CONFIG.logoPosition || 'center');
    var logo = document.getElementById('logoBadge');
    if(COMPANY_CONFIG.logoImageUrl){
      logo.innerHTML = '<img src="' + COMPANY_CONFIG.logoImageUrl + '" alt="' + COMPANY_CONFIG.name + ' logo">';
    } else {
      logo.textContent = COMPANY_CONFIG.logoText || COMPANY_CONFIG.name.slice(0,4).toUpperCase();
    }
    document.getElementById('companyName').textContent = COMPANY_CONFIG.name;
    document.getElementById('companyAddr').textContent = COMPANY_CONFIG.address;
  }

  function renderReportMeta(){
    document.getElementById('cashierName').textContent = 'By ' + REPORT_DATA.cashier;
    document.getElementById('outletName').textContent = REPORT_DATA.outlet;
    document.getElementById('reportDate').textContent = REPORT_DATA.date;
    document.getElementById('reportRef').textContent = 'Ref: ' + REPORT_DATA.ref;
    document.getElementById('generatedLine').textContent = 'Generated ' + REPORT_DATA.generatedAt + ' · ' + COMPANY_CONFIG.name.split(' ')[0] + ' Cashier Management';
  }

  function renderCollection(){
    var c = REPORT_DATA.collection;
    document.getElementById('systemSalesAmt').textContent = fmt(c.systemSales);
    var grid = document.getElementById('collectionGrid');
    var cells = [
      {label:'Cash', amount:c.cash},
      {label:'CRDB', amount:c.crdb},
      {label:'Stanbic', amount:c.stanbic},
      {label:'M-Pesa', amount:c.mpesa},
      {label:'CRDB Lipa Hapa', amount:c.crdbLipaHapa}
    ];
    grid.innerHTML = cells.map(function(cell){
      return '<div class="cell"><div class="label">' + cell.label + '</div><div class="amount">' + fmt(cell.amount) + '</div></div>';
    }).join('');

    var totalCollected = c.cash + c.crdb + c.stanbic + c.mpesa + c.crdbLipaHapa;
    var variance = totalCollected - c.systemSales;
    document.getElementById('collectedTotalRow').innerHTML =
      '<span>Total collected</span><span>' + fmt(totalCollected) + '</span>';
    document.getElementById('varianceRow').innerHTML =
      '<span>Variance (collected − system sales)</span><span class="amount' + (variance < 0 ? ' neg' : '') + '">' + (variance < 0 ? '-' : '') + fmt(Math.abs(variance)) + '</span>';

    return c.cash;
  }

  function renderSignedBills(data){
    var host = document.getElementById('categoriesHost');
    host.innerHTML = '';
    var appendixEntries = [];
    var grand = 0;
    var peopleCount = 0, billCount = 0;

    CATEGORY_META.forEach(function(meta){
      var entries = (data[meta.key] || []).slice().sort(function(a,b){ return total(b) - total(a); });
      if(entries.length === 0) return;
      var subtotal = entries.reduce(function(s,e){ return s + total(e); }, 0);
      grand += subtotal;
      peopleCount += entries.length;

      var catDiv = document.createElement('div');
      catDiv.className = 'category';

      var titleDiv = document.createElement('div');
      titleDiv.className = 'category-title';
      titleDiv.innerHTML = '<span class="name"><span class="dot" style="background:' + meta.color + '"></span>' + meta.label + '</span><span class="subtotal">' + fmt(subtotal) + '</span>';
      catDiv.appendChild(titleDiv);

      var ledger = document.createElement('div');
      ledger.className = 'ledger-cols';
      entries.forEach(function(e){
        billCount += e.details.length;
        var item = document.createElement('div');
        item.className = 'ledger-item';
        var multiTag = e.details.length > 1 ? '<span class="multi">(' + e.details.length + ' bills)</span>' : '';
        item.innerHTML = '<span class="lname">' + e.name + multiTag + '</span><span class="lamt">' + fmt(total(e)) + '</span>';
        ledger.appendChild(item);
        if(e.details.length > 1){
          appendixEntries.push({name:e.name, details:e.details});
        }
      });
      catDiv.appendChild(ledger);
      host.appendChild(catDiv);
    });

    document.getElementById('grandTotalRow').innerHTML =
      '<span>Total signed bills (' + peopleCount + ' people, ' + billCount + ' bills)</span><span>' + fmt(grand) + '</span>';

    var appendixHost = document.getElementById('appendixHost');
    var appendixList = document.getElementById('appendixList');
    if(appendixEntries.length){
      appendixHost.style.display = 'block';
      appendixList.innerHTML = appendixEntries.map(function(e){
        var parts = e.details.map(function(d){ return d.who + ' ' + fmt(d.amt); }).join(' · ');
        return '<div class="a-entry"><b>' + e.name + ':</b> ' + parts + '</div>';
      }).join('');
    } else {
      appendixHost.style.display = 'none';
    }
  }

  function renderPaidBills(data){
    var host = document.getElementById('paidHost');
    host.innerHTML = '';
    var grand = 0, count = 0, any = false;

    PAID_CATEGORY_META.forEach(function(meta){
      var entries = (data[meta.key] || []).slice().sort(function(a,b){ return b.amount - a.amount; });
      if(entries.length === 0) return;
      any = true;
      var subtotal = entries.reduce(function(s,e){ return s + e.amount; }, 0);
      grand += subtotal;
      count += entries.length;

      var catDiv = document.createElement('div');
      catDiv.className = 'category';
      var titleDiv = document.createElement('div');
      titleDiv.className = 'category-title';
      titleDiv.innerHTML = '<span class="name"><span class="dot" style="background:' + meta.color + '"></span>' + meta.label + '</span><span class="subtotal">' + fmt(subtotal) + '</span>';
      catDiv.appendChild(titleDiv);

      var ledger = document.createElement('div');
      ledger.className = 'ledger-cols';
      entries.forEach(function(e){
        var item = document.createElement('div');
        item.className = 'ledger-item';
        item.innerHTML = '<span class="lname">' + e.name + '<span class="multi">' + e.method + '</span></span><span class="lamt">' + fmt(e.amount) + '</span>';
        ledger.appendChild(item);
      });
      catDiv.appendChild(ledger);
      host.appendChild(catDiv);
    });

    if(!any){
      var row = document.createElement('div');
      row.className = 'row';
      row.innerHTML = '<span class="label">No paid bills</span><span class="amount">' + fmt(0) + '</span>';
      host.appendChild(row);
    }

    document.getElementById('paidTotalRow').innerHTML =
      '<span>Total paid bills' + (count ? ' (' + count + ' payments)' : '') + '</span><span>' + fmt(grand) + '</span>';
  }

  function renderSimpleLedger(hostId, totalId, items, emptyLabel, unitLabel){
    var host = document.getElementById(hostId);
    host.innerHTML = '';
    if(items.length === 0){
      var row = document.createElement('div');
      row.className = 'row';
      row.innerHTML = '<span class="label">' + emptyLabel + '</span><span class="amount">' + fmt(0) + '</span>';
      host.appendChild(row);
    } else {
      var ledger = document.createElement('div');
      ledger.className = 'ledger-cols';
      items.forEach(function(it){
        var item = document.createElement('div');
        item.className = 'ledger-item';
        var tag = it.tag ? '<span class="multi">' + it.tag + '</span>' : '';
        item.innerHTML = '<span class="lname">' + it.label + tag + '</span><span class="lamt">' + fmt(it.amount) + '</span>';
        ledger.appendChild(item);
      });
      host.appendChild(ledger);
    }
    var t = items.reduce(function(s,it){ return s + it.amount; }, 0);
    var countLabel = items.length ? ' (' + items.length + ' ' + (unitLabel || 'items') + ')' : '';
    document.getElementById(totalId).innerHTML =
      '<span>' + emptyLabel.replace('No ', 'Total ') + countLabel + '</span><span>' + fmt(t) + '</span>';
    return t;
  }

  function checkFit(){
    var h = document.getElementById('reportContent').scrollHeight;
    var budget = 1000; // approx A4 usable height at 96dpi with normal margins — tune to the real printer
    var note = document.getElementById('fitNote');
    if(h <= budget){
      note.textContent = 'Fits on one page (~' + h + 'px of ~' + budget + 'px)';
    } else {
      note.textContent = 'Spills to about ' + Math.ceil(h / budget) + ' pages (~' + h + 'px of ~' + budget + 'px budget)';
    }
  }

  function render(){
    renderCompanyHeader();
    renderReportMeta();
    var cash = renderCollection();
    renderSignedBills(REPORT_DATA.signed);
    renderPaidBills(REPORT_DATA.paid);
    renderSimpleLedger('cancellationsHost', 'cancellationsTotalRow', REPORT_DATA.cancellations, 'No cancellations', 'products');
    renderSimpleLedger('discountsHost', 'discountsTotalRow', REPORT_DATA.discounts, 'No discounts', 'customers');
    var pettyTotal = renderSimpleLedger('pettyHost', 'pettyTotalRow', REPORT_DATA.pettyCash, 'No petty cash', 'items');

    document.getElementById('pettyPaidOutAmt').textContent = fmt(pettyTotal);
    // Cash in hand = Cash collected − Approved petty cash paid out.
    // Paid bills / cancellations / discounts are not netted into this figure —
    // confirm with finance before changing that.
    document.getElementById('cashInHandAmt').textContent = fmt(cash - pettyTotal);

    requestAnimationFrame(checkFit);
  }

  window.addEventListener('resize', function(){ requestAnimationFrame(checkFit); });
  render();
</script>
</body>
</html>
```
