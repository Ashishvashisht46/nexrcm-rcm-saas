// ─── NexRCM Database Seed ────────────────────────────────────
// Run: npm run db:seed
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

async function seed() {
  console.log('🌱 Seeding NexRCM database...\n');

  // ── Organization ──────────────────────────────────────────
  const org = await prisma.organization.create({
    data: {
      name: 'Summit Health Medical Group',
      npi: '1234567890',
      taxId: '12-3456789',
      phone: '(555) 100-2000',
      email: 'admin@summithealthmg.com',
      address: '1200 Healthcare Blvd, Suite 400',
      city: 'Austin',
      state: 'TX',
      zip: '78701',
      subscriptionTier: 'enterprise',
    },
  });
  console.log('✅ Organization created');

  // ── Locations ─────────────────────────────────────────────
  const locations = await Promise.all([
    prisma.location.create({ data: { orgId: org.id, name: 'Main Campus', address: '1200 Healthcare Blvd', city: 'Austin', state: 'TX', zip: '78701', phone: '(555) 100-2001', placeOfService: '11', npi: '1234567890' } }),
    prisma.location.create({ data: { orgId: org.id, name: 'Westlake Clinic', address: '4500 Bee Caves Rd', city: 'Austin', state: 'TX', zip: '78746', phone: '(555) 100-2002', placeOfService: '11' } }),
    prisma.location.create({ data: { orgId: org.id, name: 'Round Rock Office', address: '200 University Blvd', city: 'Round Rock', state: 'TX', zip: '78665', phone: '(555) 100-2003', placeOfService: '11' } }),
  ]);
  console.log('✅ 3 Locations created');

  // ── Users (Staff) ─────────────────────────────────────────
  const password = await bcrypt.hash('NexRCM2024!', 12);
  const users = await Promise.all([
    prisma.user.create({ data: { orgId: org.id, email: 'admin@summithealthmg.com', passwordHash: password, firstName: 'Dr. Alan', lastName: 'Reid', role: 'ADMIN', phone: '(555) 100-3001' } }),
    prisma.user.create({ data: { orgId: org.id, email: 'sarah@summithealthmg.com', passwordHash: password, firstName: 'Sarah', lastName: 'Chen', role: 'BILLING_MANAGER', phone: '(555) 100-3002' } }),
    prisma.user.create({ data: { orgId: org.id, email: 'mike@summithealthmg.com', passwordHash: password, firstName: 'Mike', lastName: 'Torres', role: 'BILLER', phone: '(555) 100-3003' } }),
    prisma.user.create({ data: { orgId: org.id, email: 'jessica@summithealthmg.com', passwordHash: password, firstName: 'Jessica', lastName: 'Patel', role: 'FRONT_DESK', phone: '(555) 100-3004' } }),
    prisma.user.create({ data: { orgId: org.id, email: 'lisa@summithealthmg.com', passwordHash: password, firstName: 'Lisa', lastName: 'Kim', role: 'AR_SPECIALIST', phone: '(555) 100-3005' } }),
    prisma.user.create({ data: { orgId: org.id, email: 'tom@summithealthmg.com', passwordHash: password, firstName: 'Tom', lastName: 'Wagner', role: 'CODER', phone: '(555) 100-3006' } }),
    prisma.user.create({ data: { orgId: org.id, email: 'maria@summithealthmg.com', passwordHash: password, firstName: 'Maria', lastName: 'Gonzalez', role: 'CREDENTIALING', phone: '(555) 100-3007' } }),
  ]);
  console.log('✅ 7 Users created (password: NexRCM2024!)');

  // ── Providers ─────────────────────────────────────────────
  const providers = await Promise.all([
    prisma.provider.create({ data: { orgId: org.id, firstName: 'Alan', lastName: 'Reid', npi: '1234567890', specialty: 'Internal Medicine', taxonomy: '207R00000X', licenseNumber: 'TX-MD-12345', licenseState: 'TX', licenseExpiry: new Date('2026-12-31'), email: 'admin@summithealthmg.com' } }),
    prisma.provider.create({ data: { orgId: org.id, firstName: 'Emily', lastName: 'Carter', npi: '2345678901', specialty: 'Family Medicine', taxonomy: '207Q00000X', licenseNumber: 'TX-MD-23456', licenseState: 'TX', licenseExpiry: new Date('2026-08-15'), email: 'emily@summithealthmg.com' } }),
    prisma.provider.create({ data: { orgId: org.id, firstName: 'James', lastName: 'Park', npi: '3456789012', specialty: 'Orthopedics', taxonomy: '207X00000X', licenseNumber: 'TX-MD-34567', licenseState: 'TX', licenseExpiry: new Date('2026-05-30'), email: 'james@summithealthmg.com' } }),
  ]);
  console.log('✅ 3 Providers created');

  // ── Patients ──────────────────────────────────────────────
  const patientData = [
    { firstName: 'Robert', lastName: 'Johnson', dob: '1965-03-14', gender: 'Male', phone: '(555) 201-0001', email: 'robert.j@email.com', address: '100 Oak St', city: 'Austin', state: 'TX', zip: '78701' },
    { firstName: 'Maria', lastName: 'Garcia', dob: '1978-07-22', gender: 'Female', phone: '(555) 201-0002', email: 'maria.g@email.com', address: '200 Elm Ave', city: 'Austin', state: 'TX', zip: '78702' },
    { firstName: 'James', lastName: 'Williams', dob: '1952-11-08', gender: 'Male', phone: '(555) 201-0003', email: 'james.w@email.com', address: '300 Pine Rd', city: 'Round Rock', state: 'TX', zip: '78665' },
    { firstName: 'Patricia', lastName: 'Brown', dob: '1990-01-30', gender: 'Female', phone: '(555) 201-0004', email: 'patricia.b@email.com', address: '400 Cedar Ln', city: 'Austin', state: 'TX', zip: '78746' },
    { firstName: 'Michael', lastName: 'Davis', dob: '1985-05-17', gender: 'Male', phone: '(555) 201-0005', email: 'michael.d@email.com', address: '500 Maple Dr', city: 'Austin', state: 'TX', zip: '78703' },
    { firstName: 'Jennifer', lastName: 'Martinez', dob: '1972-09-03', gender: 'Female', phone: '(555) 201-0006', email: 'jennifer.m@email.com', address: '600 Birch Way', city: 'Austin', state: 'TX', zip: '78704' },
    { firstName: 'David', lastName: 'Anderson', dob: '1960-12-25', gender: 'Male', phone: '(555) 201-0007', email: 'david.a@email.com', address: '700 Spruce Ct', city: 'Round Rock', state: 'TX', zip: '78664' },
    { firstName: 'Linda', lastName: 'Thomas', dob: '1988-04-11', gender: 'Female', phone: '(555) 201-0008', email: 'linda.t@email.com', address: '800 Walnut Blvd', city: 'Austin', state: 'TX', zip: '78745' },
    { firstName: 'Christopher', lastName: 'Jackson', dob: '1975-08-19', gender: 'Male', phone: '(555) 201-0009', email: 'chris.j@email.com', address: '900 Ash St', city: 'Austin', state: 'TX', zip: '78748' },
    { firstName: 'Susan', lastName: 'White', dob: '1958-02-14', gender: 'Female', phone: '(555) 201-0010', email: 'susan.w@email.com', address: '1000 Poplar Ave', city: 'Austin', state: 'TX', zip: '78750' },
    { firstName: 'Daniel', lastName: 'Harris', dob: '1995-06-28', gender: 'Male', phone: '(555) 201-0011', email: 'daniel.h@email.com', address: '1100 Cherry Ln', city: 'Austin', state: 'TX', zip: '78751' },
    { firstName: 'Karen', lastName: 'Clark', dob: '1983-10-05', gender: 'Female', phone: '(555) 201-0012', email: 'karen.c@email.com', address: '1200 Peach Dr', city: 'Austin', state: 'TX', zip: '78752' },
  ];

  const patients = [];
  for (let i = 0; i < patientData.length; i++) {
    const p = patientData[i];
    const patient = await prisma.patient.create({
      data: {
        orgId: org.id,
        mrn: `MRN-${String(1000 + i).padStart(6, '0')}`,
        firstName: p.firstName,
        lastName: p.lastName,
        dateOfBirth: new Date(p.dob),
        gender: p.gender,
        phone: p.phone,
        email: p.email,
        address: p.address,
        city: p.city,
        state: p.state,
        zip: p.zip,
      },
    });
    patients.push(patient);
  }
  console.log(`✅ ${patients.length} Patients created`);

  // ── Insurance Policies ────────────────────────────────────
  const payers = [
    { name: 'Blue Cross Blue Shield TX', id: 'BCBS-TX', copay: 25, deductible: 1500, oopMax: 6000 },
    { name: 'Aetna', id: 'AETNA', copay: 30, deductible: 2000, oopMax: 7500 },
    { name: 'UnitedHealthcare', id: 'UHC', copay: 20, deductible: 1000, oopMax: 5000 },
    { name: 'Cigna', id: 'CIGNA', copay: 35, deductible: 2500, oopMax: 8000 },
    { name: 'Medicare', id: 'MEDICARE', copay: 0, deductible: 233, oopMax: 0 },
    { name: 'Humana', id: 'HUMANA', copay: 25, deductible: 1500, oopMax: 6500 },
  ];

  for (let i = 0; i < patients.length; i++) {
    const payer = payers[i % payers.length];
    await prisma.insurancePolicy.create({
      data: {
        patientId: patients[i].id,
        payerName: payer.name,
        payerId: payer.id,
        memberId: `${payer.id}-${String(Math.random()).slice(2, 11)}`,
        groupNumber: `GRP-${String(Math.floor(Math.random() * 9000) + 1000)}`,
        priority: 1,
        copay: payer.copay,
        deductible: payer.deductible,
        deductibleMet: Math.round(Math.random() * payer.deductible * 100) / 100,
        oopMax: payer.oopMax,
        oopMet: Math.round(Math.random() * 3000 * 100) / 100,
        coinsurance: 20,
        effectiveDate: new Date('2025-01-01'),
        isActive: true,
        verifiedAt: new Date(),
      },
    });
  }
  console.log('✅ Insurance policies created');

  // ── Claims (mix of statuses) ──────────────────────────────
  const cptCodes = [
    { code: '99213', desc: 'Office visit, est. patient, moderate', fee: 150 },
    { code: '99214', desc: 'Office visit, est. patient, moderate-high', fee: 220 },
    { code: '99203', desc: 'Office visit, new patient, low', fee: 175 },
    { code: '99204', desc: 'Office visit, new patient, moderate', fee: 285 },
    { code: '99385', desc: 'Preventive visit, 18-39 years', fee: 250 },
    { code: '99395', desc: 'Preventive visit, 40-64 years', fee: 275 },
    { code: '20610', desc: 'Joint injection, major', fee: 180 },
    { code: '99243', desc: 'Consultation, moderate', fee: 200 },
    { code: '36415', desc: 'Venipuncture', fee: 25 },
    { code: '71046', desc: 'Chest X-ray, 2 views', fee: 120 },
  ];

  const claimStatuses = ['SUBMITTED', 'SUBMITTED', 'PENDING', 'PENDING', 'PAID', 'PAID', 'PAID', 'PARTIAL', 'DENIED', 'DRAFT'];

  const claims = [];
  for (let i = 0; i < 40; i++) {
    const patient = patients[i % patients.length];
    const provider = providers[i % providers.length];
    const policy = await prisma.insurancePolicy.findFirst({ where: { patientId: patient.id, isActive: true } });
    const status = claimStatuses[i % claimStatuses.length];
    const cpt = cptCodes[i % cptCodes.length];
    const dos = new Date();
    dos.setDate(dos.getDate() - Math.floor(Math.random() * 120));
    const daysInAR = Math.floor((new Date() - dos) / (1000 * 60 * 60 * 24));
    const totalCharged = cpt.fee + (i % 3 === 0 ? 25 : 0); // Add venipuncture sometimes
    const isPaid = ['PAID', 'PARTIAL'].includes(status);
    const totalPaid = isPaid ? (status === 'PAID' ? totalCharged * 0.8 : totalCharged * 0.4) : 0;
    const adjustments = isPaid ? totalCharged * 0.15 : 0;
    const balance = totalCharged - totalPaid - adjustments;

    const claim = await prisma.claim.create({
      data: {
        orgId: org.id,
        claimNumber: `CLM-${String(20250001 + i)}`,
        patientId: patient.id,
        providerId: provider.id,
        insurancePolicyId: policy?.id,
        dateOfService: dos,
        filingDate: status !== 'DRAFT' ? new Date(dos.getTime() + 2 * 24 * 60 * 60 * 1000) : null,
        status,
        totalCharged,
        totalPaid: Math.round(totalPaid * 100) / 100,
        adjustments: Math.round(adjustments * 100) / 100,
        balance: Math.round(Math.max(0, balance) * 100) / 100,
        payerName: policy?.payerName,
        payerId: policy?.payerId,
        placeOfService: '11',
        daysInAR: status !== 'DRAFT' ? daysInAR : 0,
        scrubPassed: status !== 'DRAFT',
        aiPriority: Math.floor(Math.random() * 80) + 20,
        lines: {
          create: [
            { lineNumber: 1, cptCode: cpt.code, units: 1, chargedAmount: cpt.fee, paidAmount: isPaid ? cpt.fee * 0.7 : 0, icdPointers: [1] },
            ...(i % 3 === 0 ? [{ lineNumber: 2, cptCode: '36415', units: 1, chargedAmount: 25, paidAmount: isPaid ? 20 : 0, icdPointers: [1] }] : []),
          ],
        },
        statusHistory: {
          create: { toStatus: status, note: 'Seeded claim' },
        },
      },
    });
    claims.push(claim);
  }
  console.log(`✅ ${claims.length} Claims created`);

  // ── Denials ───────────────────────────────────────────────
  const deniedClaims = claims.filter(c => c.status === 'DENIED');
  const denialCodes = ['CO-50', 'CO-4', 'CO-16', 'CO-27', 'CO-97'];
  for (let i = 0; i < deniedClaims.length; i++) {
    await prisma.denial.create({
      data: {
        claimId: deniedClaims[i].id,
        denialDate: new Date(),
        carcCode: denialCodes[i % denialCodes.length],
        denialReason: 'Medical records not received',
        denialCategory: ['coverage', 'coding', 'medical_necessity', 'auth', 'coding'][i % 5],
        amountDenied: deniedClaims[i].totalCharged,
        isAppealable: true,
        appealDeadline: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
        recoveryLikelihood: Math.floor(Math.random() * 50) + 30,
      },
    });
  }
  console.log(`✅ ${deniedClaims.length} Denials created`);

  // ── Fee Schedule ──────────────────────────────────────────
  const feeSchedule = await prisma.feeSchedule.create({
    data: {
      orgId: org.id,
      name: 'Standard Fee Schedule 2025',
      type: 'standard',
      isDefault: true,
      effectiveDate: new Date('2025-01-01'),
      entries: {
        create: cptCodes.map(c => ({
          cptCode: c.code,
          description: c.desc,
          fee: c.fee,
        })),
      },
    },
  });
  console.log('✅ Fee schedule created');

  // ── Payer Contracts ───────────────────────────────────────
  for (const payer of payers.slice(0, 4)) {
    await prisma.payerContract.create({
      data: {
        orgId: org.id,
        payerName: payer.name,
        payerId: payer.id,
        contractNumber: `CTR-${payer.id}-2025`,
        effectiveDate: new Date('2025-01-01'),
        terminationDate: new Date('2025-12-31'),
        autoRenew: true,
        status: 'active',
        rates: {
          create: cptCodes.slice(0, 6).map(c => ({
            cptCode: c.code,
            allowedAmount: Math.round(c.fee * (0.65 + Math.random() * 0.2) * 100) / 100,
          })),
        },
      },
    });
  }
  console.log('✅ 4 Payer contracts created');

  // ── Credentials ───────────────────────────────────────────
  for (const prov of providers) {
    for (const payer of payers.slice(0, 3)) {
      await prisma.credential.create({
        data: {
          orgId: org.id,
          providerId: prov.id,
          payerName: payer.name,
          payerId: payer.id,
          status: 'APPROVED',
          applicationDate: new Date('2024-06-01'),
          effectiveDate: new Date('2024-08-01'),
          expirationDate: new Date('2026-08-01'),
        },
      });
    }
  }
  console.log('✅ Provider credentials created');

  // ── Work Queue Items ──────────────────────────────────────
  const wqTypes = ['follow_up', 'denial_review', 'coding_review', 'payment_post'];
  for (let i = 0; i < 15; i++) {
    const claim = claims[i % claims.length];
    await prisma.workQueueItem.create({
      data: {
        claimId: claim.id,
        type: wqTypes[i % wqTypes.length],
        priority: Math.floor(Math.random() * 60) + 40,
        title: `${wqTypes[i % wqTypes.length].replace('_', ' ')} — ${claim.claimNumber}`,
        description: `Auto-generated task for claim ${claim.claimNumber}`,
        dueDate: new Date(Date.now() + (i + 1) * 24 * 60 * 60 * 1000),
        aiGenerated: i % 2 === 0,
        aiReason: i % 2 === 0 ? 'AI detected high-priority item' : null,
        assignedTo: users[Math.floor(Math.random() * 3) + 1].id,
      },
    });
  }
  console.log('✅ 15 Work queue items created');

  // ── ICD-10 Codes (common ones) ────────────────────────────
  const icd10Codes = [
    { code: 'M54.5', description: 'Low back pain', category: 'Musculoskeletal', isCommon: true },
    { code: 'I10', description: 'Essential (primary) hypertension', category: 'Circulatory', isCommon: true },
    { code: 'E11.9', description: 'Type 2 diabetes mellitus without complications', category: 'Endocrine', isCommon: true },
    { code: 'J06.9', description: 'Acute upper respiratory infection, unspecified', category: 'Respiratory', isCommon: true },
    { code: 'Z00.00', description: 'General adult medical exam without abnormal findings', category: 'Factors', isCommon: true },
    { code: 'M79.3', description: 'Panniculitis, unspecified', category: 'Musculoskeletal', isCommon: false },
    { code: 'R10.9', description: 'Unspecified abdominal pain', category: 'Symptoms', isCommon: true },
    { code: 'F41.1', description: 'Generalized anxiety disorder', category: 'Mental', isCommon: true },
    { code: 'F32.9', description: 'Major depressive disorder, single episode, unspecified', category: 'Mental', isCommon: true },
    { code: 'K21.0', description: 'Gastro-esophageal reflux disease with esophagitis', category: 'Digestive', isCommon: true },
    { code: 'E78.5', description: 'Hyperlipidemia, unspecified', category: 'Endocrine', isCommon: true },
    { code: 'J45.909', description: 'Unspecified asthma, uncomplicated', category: 'Respiratory', isCommon: true },
    { code: 'N39.0', description: 'Urinary tract infection, site not specified', category: 'Genitourinary', isCommon: true },
    { code: 'M25.511', description: 'Pain in right shoulder', category: 'Musculoskeletal', isCommon: true },
    { code: 'G43.909', description: 'Migraine, unspecified, not intractable', category: 'Nervous', isCommon: true },
  ];
  await prisma.iCD10Code.createMany({ data: icd10Codes, skipDuplicates: true });
  console.log(`✅ ${icd10Codes.length} ICD-10 codes seeded`);

  // ── CPT Codes ─────────────────────────────────────────────
  const cptSeedCodes = [
    { code: '99201', description: 'Office visit, new patient, straightforward', category: 'E&M', medicareFee: 45, isCommon: false },
    { code: '99202', description: 'Office visit, new patient, straightforward', category: 'E&M', medicareFee: 75, isCommon: true },
    { code: '99203', description: 'Office visit, new patient, low complexity', category: 'E&M', medicareFee: 110, isCommon: true },
    { code: '99204', description: 'Office visit, new patient, moderate complexity', category: 'E&M', medicareFee: 170, isCommon: true },
    { code: '99205', description: 'Office visit, new patient, high complexity', category: 'E&M', medicareFee: 215, isCommon: true },
    { code: '99211', description: 'Office visit, est. patient, may not require physician', category: 'E&M', medicareFee: 25, isCommon: true },
    { code: '99212', description: 'Office visit, est. patient, straightforward', category: 'E&M', medicareFee: 55, isCommon: true },
    { code: '99213', description: 'Office visit, est. patient, low complexity', category: 'E&M', medicareFee: 95, isCommon: true },
    { code: '99214', description: 'Office visit, est. patient, moderate complexity', category: 'E&M', medicareFee: 135, isCommon: true },
    { code: '99215', description: 'Office visit, est. patient, high complexity', category: 'E&M', medicareFee: 185, isCommon: true },
    { code: '99385', description: 'Preventive visit, new, 18-39 years', category: 'Preventive', medicareFee: 155, isCommon: true },
    { code: '99386', description: 'Preventive visit, new, 40-64 years', category: 'Preventive', medicareFee: 175, isCommon: true },
    { code: '99395', description: 'Preventive visit, est., 40-64 years', category: 'Preventive', medicareFee: 160, isCommon: true },
    { code: '36415', description: 'Collection of venous blood by venipuncture', category: 'Path/Lab', medicareFee: 12, isCommon: true },
    { code: '71046', description: 'Chest X-ray, 2 views', category: 'Radiology', medicareFee: 65, isCommon: true },
    { code: '20610', description: 'Arthrocentesis/injection, major joint', category: 'Surgery', medicareFee: 95, isCommon: true },
    { code: '17000', description: 'Destruction of premalignant lesion, first', category: 'Surgery', medicareFee: 70, isCommon: false },
    { code: '90834', description: 'Psychotherapy, 45 minutes', category: 'Psychiatry', medicareFee: 100, isCommon: true },
    { code: '96372', description: 'Therapeutic injection, SC or IM', category: 'Medicine', medicareFee: 30, isCommon: true },
    { code: '93000', description: 'Electrocardiogram, 12-lead', category: 'Cardiology', medicareFee: 45, isCommon: true },
  ];
  await prisma.cPTCode.createMany({ data: cptSeedCodes, skipDuplicates: true });
  console.log(`✅ ${cptSeedCodes.length} CPT codes seeded`);

  // ── CARC Codes ────────────────────────────────────────────
  const carcCodes = [
    { code: 'CO-4', description: 'The procedure code is inconsistent with the modifier used', category: 'Coding', isCommon: true },
    { code: 'CO-11', description: 'The diagnosis is inconsistent with the procedure', category: 'Coding', isCommon: true },
    { code: 'CO-15', description: 'The authorization number is missing, invalid, or does not apply', category: 'Authorization', isCommon: true },
    { code: 'CO-16', description: 'Claim/service lacks information needed for adjudication', category: 'Information', isCommon: true },
    { code: 'CO-18', description: 'Exact duplicate claim/service', category: 'Duplicate', isCommon: true },
    { code: 'CO-22', description: 'This care may be covered by another payer per coordination of benefits', category: 'COB', isCommon: true },
    { code: 'CO-27', description: 'Expenses incurred after coverage terminated', category: 'Coverage', isCommon: true },
    { code: 'CO-29', description: 'The time limit for filing has expired', category: 'Timely Filing', isCommon: true },
    { code: 'CO-50', description: 'Non-covered services because not deemed medically necessary', category: 'Medical Necessity', isCommon: true },
    { code: 'CO-97', description: 'Payment adjusted because benefits are not provided for this service', category: 'Benefits', isCommon: true },
    { code: 'PR-1', description: 'Deductible amount', category: 'Patient Responsibility', isCommon: true },
    { code: 'PR-2', description: 'Coinsurance amount', category: 'Patient Responsibility', isCommon: true },
    { code: 'PR-3', description: 'Co-payment amount', category: 'Patient Responsibility', isCommon: true },
  ];
  await prisma.cARCCode.createMany({ data: carcCodes, skipDuplicates: true });
  console.log(`✅ ${carcCodes.length} CARC codes seeded`);

  // ── Scrub Rules ───────────────────────────────────────────
  const scrubRules = [
    { name: 'Valid NPI Required', category: 'npi', severity: 'error', condition: { field: 'provider.npi', operator: 'length_equals', value: 10 }, message: 'Provider NPI must be exactly 10 digits.' },
    { name: 'Patient DOB Required', category: 'demographics', severity: 'error', condition: { field: 'patient.dateOfBirth', operator: 'exists' }, message: 'Patient date of birth is required for claim submission.' },
    { name: 'Insurance Member ID Required', category: 'payer', severity: 'error', condition: { field: 'insurancePolicy.memberId', operator: 'exists' }, message: 'Insurance member ID is required.' },
    { name: 'Future DOS Check', category: 'diagnosis', severity: 'error', condition: { field: 'dateOfService', operator: 'not_future' }, message: 'Date of service cannot be in the future.' },
    { name: 'Timely Filing Warning', category: 'payer', severity: 'warning', condition: { field: 'dateOfService', operator: 'within_days', value: 365 }, message: 'Claim may exceed timely filing limit for some payers.' },
    { name: 'At Least One CPT Code', category: 'diagnosis', severity: 'error', condition: { field: 'lines', operator: 'min_count', value: 1 }, message: 'At least one CPT code (claim line) is required.' },
    { name: 'Positive Charge Amount', category: 'diagnosis', severity: 'error', condition: { field: 'lines.chargedAmount', operator: 'greater_than', value: 0 }, message: 'All line charges must be greater than $0.' },
    { name: 'Modifier 25 with E&M', category: 'modifier', severity: 'warning', condition: { field: 'lines', operator: 'em_with_procedure' }, message: 'E&M code billed with procedure — modifier 25 may be required.' },
  ];
  await prisma.scrubRule.createMany({ data: scrubRules });
  console.log(`✅ ${scrubRules.length} Scrub rules created`);

  // ── Automation Rules ──────────────────────────────────────
  const autoRules = [
    { orgId: org.id, name: 'Auto-verify eligibility on check-in', trigger: 'appointment_check_in', conditions: { eligibilityVerified: false }, actions: { type: 'verify_eligibility' }, isActive: true },
    { orgId: org.id, name: 'Flag claims aging 30+ days', trigger: 'aging_threshold', conditions: { daysInAR: { gte: 30 }, status: 'SUBMITTED' }, actions: { type: 'create_work_queue_item', taskType: 'follow_up' }, isActive: true },
    { orgId: org.id, name: 'Auto-categorize denials', trigger: 'claim_denied', conditions: {}, actions: { type: 'categorize_denial', generateAppealDraft: true }, isActive: true },
    { orgId: org.id, name: 'Send patient statement at 30 days', trigger: 'schedule', conditions: { patientBalance: { gte: 25 }, daysSinceLastStatement: { gte: 30 } }, actions: { type: 'generate_statement', sendVia: 'email' }, isActive: true },
    { orgId: org.id, name: 'Alert on expiring credentials', trigger: 'schedule', conditions: { daysUntilExpiry: { lte: 90 } }, actions: { type: 'send_notification', recipients: ['admin', 'credentialing'] }, isActive: true },
  ];
  await prisma.automationRule.createMany({ data: autoRules });
  console.log(`✅ ${autoRules.length} Automation rules created`);

  // ── Audit Log Samples ─────────────────────────────────────
  const auditEntries = [
    { orgId: org.id, userId: users[0].id, action: 'login', resource: 'user', details: { ip: '10.0.0.1' } },
    { orgId: org.id, userId: users[1].id, action: 'create', resource: 'claim', details: { claimNumber: 'CLM-20250001' } },
    { orgId: org.id, userId: users[2].id, action: 'submit', resource: 'claim', details: { claimNumber: 'CLM-20250002', clearinghouse: 'Change Healthcare' } },
    { orgId: org.id, userId: users[3].id, action: 'check_in', resource: 'appointment', details: { patientName: 'Robert Johnson' } },
    { orgId: org.id, userId: users[1].id, action: 'export', resource: 'report', details: { reportType: 'aging_summary' } },
  ];
  await prisma.auditLog.createMany({ data: auditEntries });
  console.log('✅ Audit log entries created');

  console.log('\n═══════════════════════════════════════════════════');
  console.log('🎉 Database seeded successfully!');
  console.log('═══════════════════════════════════════════════════');
  console.log(`\n📧 Login credentials (all accounts):`);
  console.log(`   Email: admin@summithealthmg.com (or any staff email)`);
  console.log(`   Password: NexRCM2024!`);
  console.log(`\n📊 Data summary:`);
  console.log(`   Organization: ${org.name}`);
  console.log(`   Locations: 3`);
  console.log(`   Staff: ${users.length}`);
  console.log(`   Providers: ${providers.length}`);
  console.log(`   Patients: ${patients.length}`);
  console.log(`   Claims: ${claims.length}`);
  console.log(`   Denials: ${deniedClaims.length}`);
  console.log(`   Automation rules: ${autoRules.length}`);
}

seed()
  .catch(err => {
    console.error('❌ Seed failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
