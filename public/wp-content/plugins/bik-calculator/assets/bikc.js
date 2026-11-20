/* Benefit in Kind Calculator — front end
 *
 * The form is already in the page. This file only reads the values,
 * does the sums, and writes the results panel.
 *
 * To add a benefit: add it to BIKC_Benefits::all() in PHP, then add a
 * matching function to CALCS below using the same id.
 */
(function () {
	'use strict';

	var DATA = window.BIKC_DATA || {};
	var R = DATA.rates || {};

	var root = document.querySelector('[data-bikc]');
	if (!root) { return; }

	/* ------------------------------------------------------------ Helpers */

	function num(v) {
		if (typeof v === 'number') { return isFinite(v) ? v : 0; }
		var n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, ''));
		return isFinite(n) ? n : 0;
	}

	function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

	function money(v) {
		return '£' + Math.abs(v).toLocaleString('en-GB', {
			minimumFractionDigits: 2, maximumFractionDigits: 2
		});
	}

	function money0(v) {
		return '£' + Math.round(Math.abs(v)).toLocaleString('en-GB');
	}

	function el(tag, cls, text) {
		var n = document.createElement(tag);
		if (cls) { n.className = cls; }
		if (text != null) { n.textContent = text; }
		return n;
	}

	function each(list, fn) { Array.prototype.forEach.call(list, fn); }

	/* --------------------------------------------------------- Tax engine */

	function bandsFor(region) {
		return region === 'scotland' ? (R.bands_scotland || []) : (R.bands_ruk || []);
	}

	function taxOnTaxable(taxable, bands) {
		var tax = 0, prev = 0;
		for (var i = 0; i < bands.length; i++) {
			var upper = num(bands[i].up_to) > 0 ? num(bands[i].up_to) : Infinity;
			if (taxable > prev) {
				tax += (Math.min(taxable, upper) - prev) * num(bands[i].rate) / 100;
			}
			prev = upper;
			if (taxable <= upper) { break; }
		}
		return tax;
	}

	function allowanceFor(income, code) {
		if (code && code.fixedAllowance !== null && code.fixedAllowance !== undefined) {
			return code.fixedAllowance;
		}
		var pa = num(R.personal_allowance);
		var start = num(R.taper_start);
		var div = num(R.taper_divisor) || 2;
		if (income > start) { pa = Math.max(0, pa - (income - start) / div); }
		return pa;
	}

	/* opts.extend      — relief at source pushes every band threshold up
	 * opts.adjustedNet — income used for the personal allowance taper, which
	 *                    is not always the income being taxed */
	function incomeTax(income, region, code, opts) {
		opts = opts || {};
		if (code && code.noTax) { return 0; }
		if (code && code.flatRate !== null) { return Math.max(0, income) * code.flatRate / 100; }

		var ani = (opts.adjustedNet === undefined || opts.adjustedNet === null) ? income : opts.adjustedNet;
		var allowance = allowanceFor(ani, code);
		var bands = bandsFor(region);
		var ext = num(opts.extend);

		if (ext > 0) {
			bands = bands.map(function (b) {
				return { up_to: num(b.up_to) > 0 ? num(b.up_to) + ext : 0, rate: b.rate };
			});
		}
		return taxOnTaxable(Math.max(0, income - allowance), bands);
	}

	function employeeNI(pay) {
		var pt = num(R.ni_primary_threshold), uel = num(R.ni_upper_limit), ni = 0;
		if (pay > pt) { ni += (Math.min(pay, uel) - pt) * num(R.ni_main_rate) / 100; }
		if (pay > uel) { ni += (pay - uel) * num(R.ni_upper_rate) / 100; }
		return Math.max(0, ni);
	}

	function studentLoan(pay, planKey) {
		var plan = (R.student_plans || {})[planKey];
		if (!plan || pay <= num(plan.threshold)) { return 0; }
		return Math.floor((pay - num(plan.threshold)) * num(plan.rate) / 100);
	}

	function parseCode(raw) {
		var out = { valid: false, region: null, fixedAllowance: null, flatRate: null, noTax: false, desc: '' };
		var c = String(raw || '').toUpperCase().replace(/\s/g, '');
		if (!c) { return out; }

		var body = c;
		if (body.charAt(0) === 'S') { out.region = 'scotland'; body = body.slice(1); }
		else if (body.charAt(0) === 'C') { out.region = 'ruk'; body = body.slice(1); }

		var b = bandsFor(out.region || 'ruk');
		var scot = out.region === 'scotland';
		var rate = function (i) { return b[i] ? num(b[i].rate) : 20; };

		if (body === 'NT') {
			out.valid = true; out.noTax = true;
			out.desc = 'No tax is taken from this job.';
			return out;
		}
		if (body === 'BR') {
			out.valid = true; out.flatRate = scot ? rate(1) : rate(0);
			out.desc = 'All pay from this job taxed at ' + out.flatRate + '%, no allowance.';
			return out;
		}
		var d = body.match(/^D([0-3])$/);
		if (d) {
			var idx = (scot ? 2 : 1) + parseInt(d[1], 10);
			out.valid = true; out.flatRate = rate(Math.min(idx, b.length - 1));
			out.desc = 'All pay from this job taxed at ' + out.flatRate + '%, no allowance.';
			return out;
		}
		if (body === '0T') {
			out.valid = true; out.fixedAllowance = 0;
			out.desc = 'No tax-free allowance on this job.';
			return out;
		}
		var k = body.match(/^K(\d+)$/);
		if (k) {
			out.valid = true;
			out.fixedAllowance = -(parseInt(k[1], 10) * 10);
			out.desc = 'A K code adds ' + money0(-out.fixedAllowance) + ' to your taxable pay.';
			return out;
		}
		var std = body.match(/^(\d{1,4})([LMNTYWX])$/);
		if (std) {
			out.valid = true;
			out.fixedAllowance = parseInt(std[1], 10) * 10;
			out.desc = 'Tax-free allowance of ' + money0(out.fixedAllowance) + '.';
			return out;
		}
		out.desc = 'Code not recognised — using the standard allowance instead.';
		return out;
	}

	/* A 0 in a "max" column means "and above", but only where the matching
	 * "min" is above 0. Keeps the zero-emission row meaning exactly zero. */
	function upperBound(max, min) {
		if (num(max) > 0) { return num(max); }
		return num(min) === 0 ? 0 : Infinity;
	}

	function carPercentage(co2, range) {
		var bands = R.car_bands || [];
		for (var i = 0; i < bands.length; i++) {
			var b = bands[i];
			var hi = upperBound(b.co2_max, b.co2_min);
			if (co2 < num(b.co2_min) || co2 > hi) { continue; }

			var rLo = num(b.range_min);
			var rHi = upperBound(b.range_max, b.range_min);
			if (co2 >= 1 && co2 <= 50 && (rLo > 0 || rHi < Infinity)) {
				if (range < rLo || range > rHi) { continue; }
			}
			return num(b.pct);
		}
		return num(R.appropriate_pct_cap) || 37;
	}

	/* ------------------------------------------------------ Benefit maths */
	/* Each returns an array of ledger lines: {label, value, note, class1}. */

	function cost(label) {
		return function (v) { return [{ label: label, value: num(v.cost) }]; };
	}

	var CALCS = {

		car: function (v) {
			var p11d = num(v.p11d);
			if (!p11d) { return []; }
			var pct = carPercentage(num(v.co2), num(v.range));
			if (v.fuel === 'diesel') {
				pct = Math.min(pct + num(R.diesel_supplement), num(R.appropriate_pct_cap));
			}
			var months = clamp(num(v.months) || 12, 0, 12);
			var base = (p11d - Math.min(num(v.capital), num(R.capital_contrib_cap))) * (pct / 100) * (months / 12);

			var lines = [{
				label: 'Company car',
				value: Math.max(0, base - num(v.privatePay)),
				note: pct + '% of ' + money0(p11d) + (months < 12 ? ', ' + months + ' months' : '')
			}];
			if (v.fuelProvided) {
				lines.push({
					label: 'Private fuel',
					value: num(R.car_fuel_multiplier) * (pct / 100) * (months / 12),
					note: pct + '% of the ' + money0(num(R.car_fuel_multiplier)) + ' multiplier'
				});
			}
			return lines;
		},

		van: function (v) {
			if (!v.privateUse) { return [{ label: 'Company van', value: 0, note: 'Business and commuting only — no charge' }]; }
			if (v.zeroEmission) { return [{ label: 'Company van', value: 0, note: 'Zero-emission vans are exempt' }]; }
			var m = clamp(num(v.months) || 12, 0, 12) / 12;
			var lines = [{
				label: 'Company van',
				value: Math.max(0, num(R.van_benefit_charge) * m - num(v.privatePay)),
				note: 'Flat ' + money0(num(R.van_benefit_charge)) + ' charge'
			}];
			if (v.fuelProvided) {
				lines.push({ label: 'Van fuel', value: num(R.van_fuel_charge) * m, note: 'Flat charge' });
			}
			return lines;
		},

		medical: cost('Private medical insurance'),
		dental: cost('Dental or optical cover'),
		insurance: cost('Critical illness or income protection'),
		broadband: cost('Home broadband'),
		travel: cost('Season ticket or commuting'),
		parking: cost('Parking away from work'),

		gym: function (v) {
			if (v.onSite) { return [{ label: 'Gym membership', value: 0, note: 'On-site staff facilities are exempt' }]; }
			return [{ label: 'Gym or health club', value: num(v.cost) }];
		},

		loan: function (v) {
			var bal = num(v.balance);
			if (bal <= num(R.loan_de_minimis)) {
				return [{ label: 'Cheap loan', value: 0, note: 'Below the ' + money0(num(R.loan_de_minimis)) + ' threshold' }];
			}
			var gap = Math.max(0, num(R.official_rate) - num(v.ratePaid));
			return [{
				label: 'Cheap loan',
				value: bal * gap / 100,
				note: gap.toFixed(2) + '% below HMRC\u2019s official rate of ' + num(R.official_rate) + '%'
			}];
		},

		accommodation: function (v) {
			var lines = [{ label: 'Living accommodation', value: Math.max(0, num(v.annualValue) - num(v.rentPaid)) }];
			var c = num(v.employerCost);
			if (c > num(R.accommodation_cost_cap)) {
				lines.push({
					label: 'Accommodation — additional charge',
					value: (c - num(R.accommodation_cost_cap)) * num(R.official_rate) / 100,
					note: num(R.official_rate) + '% of the excess over ' + money0(num(R.accommodation_cost_cap))
				});
			}
			return lines;
		},

		vouchers: function (v) {
			return [{ label: 'Vouchers and gift cards', value: num(v.cost), class1: true }];
		},

		phone: function (v) {
			if (v.exempt) { return [{ label: 'Mobile phone', value: 0, note: 'One employer-contracted phone is exempt' }]; }
			return [{ label: 'Mobile phone', value: num(v.cost) }];
		},

		childcare: function (v, ctx) {
			var ex = num(R.childcare_basic_weekly);
			if (ctx.marginal >= 45) { ex = num(R.childcare_additional_weekly); }
			else if (ctx.marginal >= 40) { ex = num(R.childcare_higher_weekly); }
			return [{
				label: 'Childcare vouchers',
				value: Math.max(0, num(v.weekly) - ex) * 52,
				note: money0(ex) + ' a week is exempt at your tax rate'
			}];
		},

		subs: function (v) {
			if (v.approved) { return [{ label: 'Professional subscriptions', value: 0, note: 'List 3 bodies are exempt' }]; }
			return [{ label: 'Professional subscriptions', value: num(v.cost) }];
		},

		relocation: function (v) {
			return [{
				label: 'Relocation costs',
				value: Math.max(0, num(v.cost) - num(R.relocation_exemption)),
				note: 'First ' + money0(num(R.relocation_exemption)) + ' exempt'
			}];
		},

		entertaining: function (v) {
			var c = num(v.cost);
			if (c <= num(R.annual_function_cap)) {
				return [{ label: 'Staff events', value: 0, note: 'Within the ' + money0(num(R.annual_function_cap)) + ' exemption' }];
			}
			return [{ label: 'Staff events', value: c, note: 'Over the limit, so the full amount is taxable' }];
		},

		custom: function (v) {
			return [{ label: v.name || 'Other benefit', value: num(v.cost), class1: !!v.ni }];
		}
	};

	/* Cars at 75g/km or less sit outside the salary sacrifice comparison. */
	var SALSAC_EXEMPT = {
		car: function (v) { return num(v.co2) <= 75; }
	};

	/* ------------------------------------------------------- Reading the form */

	var rows = root.querySelectorAll('.bikc-benefit');
	var benefitPeriod = 'month';

	/* Fields marked data-recur are entered at whatever period the toggle is on.
	 * Everything downstream works in annual figures, so convert on the way in. */
	function readRow(row) {
		var v = {};
		each(row.querySelectorAll('[data-f]'), function (inp) {
			if (inp.type === 'checkbox') {
				v[inp.dataset.f] = inp.checked;
			} else if (inp.hasAttribute('data-recur')) {
				v[inp.dataset.f] = num(inp.value) * (benefitPeriod === 'month' ? 12 : 1);
			} else {
				v[inp.dataset.f] = inp.value;
			}
		});
		return v;
	}

	function syncPeriodLabels() {
		var word = benefitPeriod === 'month' ? 'a month' : 'a year';
		each(root.querySelectorAll('.bikc-input-wrap--recur'), function (w) {
			w.dataset.suffix = word;
		});
	}

	function applyConditionals(row, v) {
		each(row.querySelectorAll('[data-showif]'), function (node) {
			var rule;
			try { rule = JSON.parse(node.dataset.showif); } catch (e) { return; }
			var val = v[rule.field];
			var show = true;
			if (rule.unchecked) { show = !val; }
			if (rule.min !== undefined) { show = show && num(val) >= rule.min; }
			if (rule.max !== undefined) { show = show && num(val) <= rule.max; }
			node.classList.toggle('is-hidden', !show);
		});
	}

	/* Three ways a UK pension contribution can be taken, and they behave
	 * differently for tax, NI and the personal allowance taper. */
	function readPension(gross) {
		var q = function (id) { return root.querySelector(id); };
		var type = q('#bikc-pension-type').value;
		var pct = clamp(num(q('#bikc-pension').value), 0, 100);
		var freq = num(q('#bikc-pension-extra-freq').value) || 12;
		var extra = num(q('#bikc-pension-extra').value) * (freq === 12 ? 12 : 1);
		var erPct = clamp(num(q('#bikc-pension-employer').value), 0, 100);

		var base = (type === 'none') ? 0 : gross * pct / 100;
		var relief = num(R.ras_basic_relief) || 20;

		var out = {
			type: type, base: base, extra: extra,
			employer: gross * erPct / 100,
			sacrifice: 0,   // off gross, before tax and NI
			preTax: 0,      // off taxable pay only
			postTax: 0,     // out of take-home
			extend: 0       // relief at source widens the bands
		};

		if (type === 'salsac') {
			out.sacrifice = base;
		} else if (type === 'netpay') {
			out.preTax = base;
		} else if (type === 'ras') {
			out.postTax = base * (1 - relief / 100);
			out.extend = base;
		}

		// An extra AVC always comes off gross, whatever the main scheme is.
		out.sacrifice += extra;
		out.employeeIn = base + extra;
		out.totalIn = out.employeeIn + out.employer;
		return out;
	}

	function readPerson() {
		var g = function (id) { return root.querySelector(id); };
		var freq = num(g('#bikc-bonus-freq').value) || 12;
		var code = parseCode(g('#bikc-taxcode').value);
		return {
			salary: num(g('#bikc-salary').value),
			bonus: num(g('#bikc-bonus').value) * (freq === 1 ? 12 : 1),
			region: code.region || g('#bikc-region').value,
			code: code,
			pension: readPension(num(g('#bikc-salary').value) + num(g('#bikc-bonus').value) * (freq === 1 ? 12 : 1)),
			student: g('#bikc-student').value
		};
	}

	function marginalRateFor(pay, region, code) {
		var step = 100;
		return Math.round(((incomeTax(pay + step, region, code) - incomeTax(pay, region, code)) / step) * 100);
	}

	/* ------------------------------------------------------------ Calculate */

	var period = 'month';

	function recalc() {
		var p = readPerson();
		var cashGross = p.salary + p.bonus;
		var ctx = { marginal: marginalRateFor(cashGross, p.region, p.code) };

		var lines = [], bikTotal = 0, class1Bik = 0, salSacTotal = 0;

		each(rows, function (row) {
			var id = row.dataset.id;
			var v = readRow(row);
			applyConditionals(row, v);

			var toggle = row.querySelector('[data-toggle]');
			var on = toggle && toggle.checked;
			row.classList.toggle('is-open', !!on);
			if (!on || !CALCS[id]) { return; }

			var out = CALCS[id](v, ctx) || [];
			var sac = num(v.__salsac);

			if (sac > 0) {
				salSacTotal += sac;
				var raw = out.reduce(function (a, l) { return a + num(l.value); }, 0);
				var exempt = SALSAC_EXEMPT[id] ? SALSAC_EXEMPT[id](v) : false;

				if (exempt) {
					if (out.length) { out[0].note = (out[0].note ? out[0].note + '. ' : '') + 'Outside the salary sacrifice comparison'; }
				} else if (sac > raw) {
					if (out.length) {
						out[0].value = num(out[0].value) + (sac - raw);
						out[0].note = 'Salary given up is higher than the benefit value, so that is what is taxed';
					} else {
						out = [{ label: id, value: sac, note: 'Taxed on the salary given up' }];
					}
				}
			}

			out.forEach(function (l) {
				var val = Math.max(0, num(l.value));
				bikTotal += val;
				if (l.class1) { class1Bik += val; }
				lines.push({ label: l.label, value: val, note: l.note || '' });
			});
		});

		var pen = p.pension;

		function takeHome(sacrifice, extraTaxable, class1Extra) {
			var afterSac = Math.max(0, cashGross - sacrifice);
			var taxable = afterSac - pen.preTax + extraTaxable;
			var tax = incomeTax(taxable, p.region, p.code, {
				extend: pen.extend,
				adjustedNet: taxable - pen.extend
			});
			var ni = employeeNI(afterSac + class1Extra);
			var sl = studentLoan(afterSac, p.student);
			return {
				take: afterSac - pen.preTax - tax - ni - sl - pen.postTax,
				tax: tax, ni: ni
			};
		}

		// Pension is present on both sides, so the difference isolates the benefits.
		var base = takeHome(pen.sacrifice, 0, 0);
		var withB = takeHome(pen.sacrifice + salSacTotal, bikTotal, class1Bik);

		// What the pension itself costs, for the pension panel.
		var pensionCost = (pen.type === 'none' && pen.extra <= 0)
			? 0
			: (function () {
				var afterNo = cashGross;
				var taxNo = incomeTax(afterNo, p.region, p.code);
				var takeNo = afterNo - taxNo - employeeNI(afterNo) - studentLoan(afterNo, p.student);
				return takeNo - base.take;
			}());

		render({
			p: p, pen: pen, lines: lines, bikTotal: bikTotal, salSacTotal: salSacTotal,
			extraTax: withB.tax - base.tax, extraNI: withB.ni - base.ni,
			netEffect: base.take - withB.take, baseTake: base.take, withTake: withB.take,
			marginal: ctx.marginal, cashGross: cashGross, pensionCost: pensionCost,
			effectiveRate: bikTotal > 0 ? ((withB.tax - base.tax) + Math.max(0, withB.ni - base.ni)) / bikTotal * 100 : 0
		});
	}

	/* --------------------------------------------------------------- Render */

	function render(o) {
		var div = period === 'month' ? 12 : 1;
		var per = period === 'month' ? ' a month' : ' a year';

		root.querySelector('#bikc-headline').textContent = money(o.netEffect / div);

		var sub = root.querySelector('#bikc-headline-sub');
		if (o.bikTotal <= 0 && o.salSacTotal <= 0) {
			sub.textContent = 'Tick a benefit to see the cost';
		} else if (o.salSacTotal > 0) {
			sub.textContent = money0(o.salSacTotal) + ' of pay given up, ' +
				money0(o.bikTotal) + ' of taxable benefit';
		} else if (o.netEffect < -0.005) {
			sub.textContent = 'You come out ahead on this arrangement';
		} else {
			sub.textContent = money0(o.bikTotal) + ' of benefits, taxed at about ' + Math.round(o.effectiveRate) + '%';
		}

		var ledger = root.querySelector('#bikc-ledger');
		ledger.innerHTML = '';

		o.lines.forEach(function (l) {
			var share = o.bikTotal > 0 ? (l.value / o.bikTotal) : 0;
			var dt = el('dt', 'bikc-ledger-term');
			dt.appendChild(el('span', 'bikc-ledger-name', l.label));
			if (l.note) { dt.appendChild(el('span', 'bikc-ledger-note', l.note)); }
			dt.appendChild(el('span', 'bikc-ledger-value', money0(l.value) + ' taxable'));
			ledger.appendChild(dt);
			ledger.appendChild(el('dd', 'bikc-ledger-cost', money(o.extraTax * share / div)));
		});

		if (o.salSacTotal > 0) {
			var dts = el('dt', 'bikc-ledger-term is-credit');
			dts.appendChild(el('span', 'bikc-ledger-name', 'Salary given up'));
			dts.appendChild(el('span', 'bikc-ledger-note', 'Reduces the pay you are taxed on'));
			dts.appendChild(el('span', 'bikc-ledger-value', money0(o.salSacTotal) + ' a year'));
			ledger.appendChild(dts);
			ledger.appendChild(el('dd', 'bikc-ledger-cost is-credit', money(o.salSacTotal / div)));
		}

		if (!o.lines.length && o.salSacTotal <= 0) {
			ledger.appendChild(el('dt', 'bikc-ledger-empty', 'Nothing added yet.'));
			ledger.appendChild(el('dd', 'bikc-ledger-empty', ''));
		}

		root.querySelector('#bikc-th-before').textContent = money(o.baseTake / div);
		root.querySelector('#bikc-th-after').textContent = money(o.withTake / div);

		var meta = root.querySelector('#bikc-meta');
		meta.innerHTML = '';
		function row(k, v) {
			var n = el('div', 'bikc-meta-row');
			n.appendChild(el('span', null, k));
			n.appendChild(el('span', 'bikc-meta-figure', v));
			meta.appendChild(n);
		}

		row('Extra income tax', money(o.extraTax / div) + per);
		row('Extra National Insurance',
			o.extraNI > 0.005 ? money(o.extraNI / div) + per : 'None — your employer pays Class 1A');
		row('Total taxable benefits', money0(o.bikTotal) + ' a year');
		row('Your marginal tax rate', o.marginal + '%');

		if (o.bikTotal > 0) {
			row('Employer\u2019s Class 1A bill', money0(o.bikTotal * num(R.ni_class1a_rate) / 100) + ' a year');
			row('Likely tax code', estimateCode(o));
		}

		renderPension(o, div, per);

		var note = root.querySelector('#bikc-taxcode-note');
		note.textContent = o.p.code.desc || '';
		note.className = 'bikc-note' + (o.p.code.desc && !o.p.code.valid ? ' is-warn' : '');
	}

	function renderPension(o, div, per) {
		var host = root.querySelector('#bikc-pension-out');
		if (!host) { return; }
		host.innerHTML = '';

		var pen = o.pen;
		root.querySelector('#bikc-pension-pct-field').classList.toggle('is-hidden', pen.type === 'none');

		if (pen.totalIn <= 0) {
			host.appendChild(el('p', 'bikc-pension-empty', 'Add a contribution to see what it costs you.'));
			return;
		}

		var relief = pen.employeeIn - o.pensionCost;

		function line(k, v, cls) {
			var n = el('div', 'bikc-pension-row' + (cls ? ' ' + cls : ''));
			n.appendChild(el('span', null, k));
			n.appendChild(el('span', 'bikc-meta-figure', v));
			host.appendChild(n);
		}

		line('Going into your pension', money(pen.totalIn / div) + per, 'is-strong');
		if (pen.employer > 0) {
			line('— of which your employer pays', money(pen.employer / div) + per);
		}
		line('Cost to your take-home', money(o.pensionCost / div) + per);
		if (relief > 0.005) {
			line('Tax and NI relief', money(relief / div) + per, 'is-credit');
		}

		if (pen.type === 'salsac' || pen.extra > 0) {
			line('National Insurance saved', money((employeeNI(o.cashGross) - employeeNI(Math.max(0, o.cashGross - pen.sacrifice))) / div) + per, 'is-credit');
		}

		var notes = [];
		if (pen.totalIn > num(R.annual_allowance)) {
			notes.push('That is above the ' + money0(num(R.annual_allowance)) +
				' annual allowance. You may owe a tax charge unless you can carry forward unused allowance from earlier years.');
		}
		if (pen.sacrifice > num(R.salsac_ni_cap)) {
			notes.push('From ' + R.salsac_cap_from + ', only the first ' + money0(num(R.salsac_ni_cap)) +
				' a year of pension salary sacrifice will be free of National Insurance. This calculator uses today\u2019s rules.');
		}
		if (pen.type === 'ras') {
			notes.push('Relief at source: your provider claims the basic rate back for you. If you pay higher or additional rate, the rest is claimed through your tax return or tax code \u2014 that part is included above.');
		}
		notes.forEach(function (t) {
			host.appendChild(el('p', 'bikc-pension-note', t));
		});
	}

	function estimateCode(o) {
		var base = allowanceFor(o.cashGross, o.p.code.fixedAllowance !== null ? o.p.code : null);
		var left = base - o.bikTotal;
		var prefix = o.p.region === 'scotland' ? 'S' : '';
		if (left >= 0) { return prefix + Math.floor(left / 10) + 'L'; }
		return prefix + 'K' + Math.max(0, Math.floor(-left / 10) - 1);
	}

	/* --------------------------------------------------------------- Wiring */

	root.addEventListener('input', recalc);
	root.addEventListener('change', recalc);

	each(root.querySelectorAll('.bikc-stub .bikc-toggle button'), function (btn) {
		btn.addEventListener('click', function () {
			period = btn.dataset.period;
			each(root.querySelectorAll('.bikc-stub .bikc-toggle button'), function (b) {
				b.classList.toggle('is-active', b === btn);
			});
			recalc();
		});
	});

	each(root.querySelectorAll('#bikc-benefit-period button'), function (btn) {
		btn.addEventListener('click', function () {
			var was = benefitPeriod;
			benefitPeriod = btn.dataset.bperiod;
			if (was === benefitPeriod) { return; }

			// Rescale what's already typed so the meaning doesn't change under them.
			var factor = benefitPeriod === 'month' ? 1 / 12 : 12;
			each(root.querySelectorAll('[data-recur]'), function (inp) {
				var v = num(inp.value);
				if (v) { inp.value = Math.round(v * factor * 100) / 100; }
			});

			each(root.querySelectorAll('#bikc-benefit-period button'), function (b) {
				b.classList.toggle('is-active', b === btn);
			});
			syncPeriodLabels();
			recalc();
		});
	});

	syncPeriodLabels();

	root.addEventListener('click', function (e) {
		var btn = e.target.closest ? e.target.closest('.bikc-help') : null;
		var openTip = root.querySelector('.bikc-tip');
		var wasMine = openTip && btn && openTip.previousElementSibling === btn;
		if (openTip) { openTip.remove(); }
		if (btn) { e.preventDefault(); }
		if (btn && !wasMine) {
			var tip = el('span', 'bikc-tip', btn.dataset.help);
			btn.parentNode.insertBefore(tip, btn.nextSibling);
		}
	});

	recalc();
}());
