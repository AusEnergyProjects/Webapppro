export type CreditexVeuSpecificationVersion = "v24" | "v25";

export type CreditexVeuGeography = "metropolitan" | "regional";

export type CreditexVeuClimateRegion = "mild" | "cold" | "hot";

export type CreditexVeuClimateZone = "4" | "5";

export type CreditexVeuLocationClass =
  | "metro_mild"
  | "metro_cold"
  | "regional_mild"
  | "regional_cold"
  | "regional_hot";

export type CreditexVeuPostcodeErrorCode =
  | "VEU_POSTCODE_INVALID_REQUEST"
  | "VEU_POSTCODE_INVALID_POSTCODE"
  | "VEU_POSTCODE_UNKNOWN"
  | "VEU_POSTCODE_INVALID_INSTALLATION_DATE"
  | "VEU_POSTCODE_DATE_UNSUPPORTED"
  | "VEU_POSTCODE_TABLE_INTEGRITY";

export interface CreditexVeuPostcodeSource {
  readonly specificationVersion: CreditexVeuSpecificationVersion;
  readonly title: string;
  readonly effectiveFrom: string;
  readonly effectiveThrough: string | null;
  readonly sourceUrl: string;
  readonly sourceTable: string;
  readonly sourcePages: string;
  readonly reviewedOn: string;
}

export interface CreditexVeuPostcodeRow {
  readonly postcode: string;
  readonly geography: CreditexVeuGeography;
  readonly gasReticulated: boolean;
  readonly climateRegion: CreditexVeuClimateRegion;
  readonly climateZone: CreditexVeuClimateZone;
  readonly locationClass: CreditexVeuLocationClass;
}

export interface CreditexVeuPostcodeRequest {
  readonly postcode: string;
  readonly installationDate: string;
}

export interface CreditexVeuPostcodeResolution extends CreditexVeuPostcodeRow {
  readonly isMetropolitan: boolean;
  readonly isRegional: boolean;
  readonly source: CreditexVeuPostcodeSource;
  readonly tableRowCount: number;
  readonly tableDigest: string;
}

interface CreditexVeuPostcodeGroup {
  readonly geography: CreditexVeuGeography;
  readonly gasReticulated: boolean;
  readonly climateRegion: CreditexVeuClimateRegion;
  readonly climateZone: CreditexVeuClimateZone;
  readonly postcodes: string;
}

export class CreditexVeuPostcodeError extends Error {
  readonly code: CreditexVeuPostcodeErrorCode;
  readonly field: "postcode" | "installationDate" | "request" | "table" | null;

  constructor(
    code: CreditexVeuPostcodeErrorCode,
    message: string,
    field: "postcode" | "installationDate" | "request" | "table" | null = null,
  ) {
    super(message);
    this.name = "CreditexVeuPostcodeError";
    this.code = code;
    this.field = field;
  }
}

export const CREDITEX_VEU_POSTCODE_TABLE_ROW_COUNT = 719;

export const CREDITEX_VEU_POSTCODE_TABLE_DIGEST =
  "fnv1a64:d1c9342c68ff9c61";

export const CREDITEX_VEU_POSTCODE_SOURCES = Object.freeze([
  Object.freeze({
    specificationVersion: "v24",
    title: "Victorian Energy Upgrades Specifications 2018 Version 24",
    effectiveFrom: "2026-06-30",
    effectiveThrough: "2026-07-20",
    sourceUrl:
      "https://www.energy.vic.gov.au/__data/assets/pdf_file/0031/792904/victorian-energy-upgrades-specifications-2018-version-24.pdf",
    sourceTable: "Table A - List of postcodes",
    sourcePages: "document pages 144-163",
    reviewedOn: "2026-08-08",
  }),
  Object.freeze({
    specificationVersion: "v25",
    title: "Victorian Energy Upgrades Specifications 2018 Version 25",
    effectiveFrom: "2026-07-21",
    effectiveThrough: null,
    sourceUrl:
      "https://www.energy.vic.gov.au/__data/assets/pdf_file/0041/795488/Victorian-Energy-Upgrades-Specifications-2018-Version-25.pdf",
    sourceTable: "Table A - List of postcodes",
    sourcePages: "document pages 145-164",
    reviewedOn: "2026-08-08",
  }),
] satisfies readonly CreditexVeuPostcodeSource[]);

// Every postcode below is an explicit Table A row. Numeric gaps are intentional.
// Do not replace these enumerations with inferred postcode ranges.
const POSTCODE_GROUPS = [
  {
    geography: "metropolitan",
    gasReticulated: true,
    climateRegion: "mild",
    climateZone: "4",
    postcodes: [
      "3000 3001 3002 3003 3004 3006 3008 3010 3011 3012 3013 3015 3016 3018 3019 3020",
      "3021 3022 3023 3024 3025 3026 3027 3028 3029 3030 3031 3032 3033 3034 3036 3037",
      "3038 3039 3040 3041 3042 3043 3044 3045 3046 3047 3048 3049 3050 3051 3052 3053",
      "3054 3055 3056 3057 3058 3059 3060 3061 3062 3063 3064 3065 3066 3067 3068 3070",
      "3071 3072 3073 3074 3075 3076 3078 3079 3081 3082 3083 3084 3085 3086 3087 3088",
      "3089 3090 3091 3093 3094 3095 3096 3097 3099 3101 3102 3103 3104 3105 3106 3107",
      "3108 3109 3111 3113 3114 3115 3116 3121 3122 3123 3124 3125 3126 3127 3128 3129",
      "3130 3131 3132 3133 3134 3135 3136 3137 3138 3141 3142 3143 3144 3145 3146 3147",
      "3148 3149 3150 3151 3152 3153 3154 3155 3156 3159 3161 3162 3163 3164 3165 3166",
      "3167 3168 3169 3170 3171 3172 3173 3174 3175 3176 3177 3178 3179 3180 3181 3182",
      "3183 3184 3185 3186 3187 3188 3189 3190 3191 3192 3193 3194 3195 3196 3197 3198",
      "3199 3200 3201 3202 3204 3205 3206 3207 3335 3336 3337 3338 3427 3428 3429 3750",
      "3751 3752 3753 3754 3755 3756 3757 3759 3760 3761 3765 3781 3782 3783 3791 3797",
      "3800 3802 3803 3804 3805 3806 3807 3808 3809 3810 3812 3813 3814 3815 3910 3911",
      "3912 3913 3915 3916 3918 3919 3920 3926 3927 3928 3929 3930 3931 3933 3934 3936",
      "3937 3938 3939 3940 3941 3942 3943 3944 3975 3976 3977 3978",
    ].join(" "),
  },
  {
    geography: "metropolitan",
    gasReticulated: true,
    climateRegion: "mild",
    climateZone: "5",
    postcodes: [
      "3139 3140 3158 3160",
    ].join(" "),
  },
  {
    geography: "regional",
    gasReticulated: true,
    climateRegion: "mild",
    climateZone: "4",
    postcodes: [
      "3211 3212 3214 3215 3216 3217 3218 3219 3220 3221 3222 3223 3224 3225 3226 3227",
      "3228 3230 3231 3249 3250 3251 3260 3265 3266 3277 3280 3282 3284 3305 3340 3840",
      "3842 3844 3847 3850 3851 3852 3853 3875 3878 3880 3921 3950 3953 3984 3987 3995",
      "3996",
    ].join(" "),
  },
  {
    geography: "regional",
    gasReticulated: false,
    climateRegion: "mild",
    climateZone: "4",
    postcodes: [
      "3213 3232 3233 3234 3235 3236 3237 3238 3239 3240 3241 3242 3243 3254 3264 3267",
      "3268 3269 3270 3271 3272 3273 3274 3275 3276 3278 3279 3281 3283 3285 3286 3287",
      "3292 3303 3304 3309 3321 3322 3325 3328 3329 3331 3332 3333 3841 3854 3856 3857",
      "3859 3865 3869 3870 3871 3873 3874 3882 3886 3887 3888 3890 3891 3892 3902 3903",
      "3904 3909 3922 3923 3925 3945 3951 3954 3956 3957 3959 3960 3962 3965 3979 3990",
      "3991 3992",
    ].join(" "),
  },
  {
    geography: "regional",
    gasReticulated: false,
    climateRegion: "cold",
    climateZone: "5",
    postcodes: [
      "3289 3293 3294 3314 3315 3351 3353 3354 3370 3373 3375 3378 3379 3381 3407 3453",
      "3458 3462 3463 3467 3468 3469 3675 3676 3697 3698 3699 3700 3701 3704 3705 3707",
      "3708 3709 3711 3712 3713 3714 3715 3717 3718 3719 3720 3722 3723 3724 3732 3733",
      "3735 3736 3737 3738 3739 3740 3741 3744 3746 3778 3779 3833 3862 3893 3895 3896",
      "3898 3900",
    ].join(" "),
  },
  {
    geography: "regional",
    gasReticulated: true,
    climateRegion: "cold",
    climateZone: "5",
    postcodes: [
      "3300 3350 3352 3355 3356 3357 3363 3364 3377 3435 3437 3450 3451 3460 3461 3677",
      "3678",
    ].join(" "),
  },
  {
    geography: "regional",
    gasReticulated: false,
    climateRegion: "mild",
    climateZone: "5",
    postcodes: [
      "3301 3302 3821 3831 3832 3835 3858 3885",
    ].join(" "),
  },
  {
    geography: "regional",
    gasReticulated: false,
    climateRegion: "cold",
    climateZone: "4",
    postcodes: [
      "3310 3311 3312 3317 3318 3319 3323 3324 3330 3334 3341 3345 3360 3361 3371 3374",
      "3384 3385 3387 3388 3390 3391 3392 3393 3395 3396 3409 3412 3413 3414 3415 3418",
      "3419 3420 3423 3424 3446 3447 3448 3472 3475 3477 3478 3480 3482 3483 3485 3515",
      "3516 3517 3518 3520 3521 3522 3523 3525 3527 3552 3554 3557 3558 3559 3562 3565",
      "3570 3571 3572 3573 3607 3608 3612 3614 3617 3619 3622 3632 3633 3634 3635 3637",
      "3638 3639 3646 3647 3649 3661 3662 3663 3664 3665 3669 3670 3671 3673 3682 3688",
      "3689 3695 3725 3726 3727 3728 3747 3749 3864 3889 3946 3958 3964 3966 3967 3971",
      "3988",
    ].join(" "),
  },
  {
    geography: "regional",
    gasReticulated: true,
    climateRegion: "cold",
    climateZone: "4",
    postcodes: [
      "3342 3358 3380 3400 3401 3402 3440 3442 3444 3464 3465 3550 3551 3555 3556 3561",
      "3563 3564 3610 3616 3618 3620 3621 3623 3624 3629 3630 3631 3636 3640 3641 3643",
      "3644 3658 3659 3660 3666 3672 3683 3685 3687 3690 3691 3694 3730 3764 3799 3860",
      "3981",
    ].join(" "),
  },
  {
    geography: "metropolitan",
    gasReticulated: false,
    climateRegion: "mild",
    climateZone: "5",
    postcodes: [
      "3430",
    ].join(" "),
  },
  {
    geography: "metropolitan",
    gasReticulated: true,
    climateRegion: "cold",
    climateZone: "5",
    postcodes: [
      "3431 3434 3438 3770 3775 3777",
    ].join(" "),
  },
  {
    geography: "metropolitan",
    gasReticulated: false,
    climateRegion: "cold",
    climateZone: "5",
    postcodes: [
      "3432 3433",
    ].join(" "),
  },
  {
    geography: "metropolitan",
    gasReticulated: true,
    climateRegion: "cold",
    climateZone: "4",
    postcodes: [
      "3441 3763 3766 3767 3785 3786 3787 3788 3789 3792 3793 3795 3796 3980",
    ].join(" "),
  },
  {
    geography: "regional",
    gasReticulated: false,
    climateRegion: "hot",
    climateZone: "4",
    postcodes: [
      "3487 3488 3489 3490 3491 3506 3507 3509 3512 3529 3530 3531 3533 3537 3540 3542",
      "3544 3546 3549 3567 3568 3575 3576 3579 3580 3581 3583 3584 3585 3586 3588 3589",
      "3590 3591 3594 3595 3596 3597 3599",
    ].join(" "),
  },
  {
    geography: "regional",
    gasReticulated: true,
    climateRegion: "hot",
    climateZone: "4",
    postcodes: [
      "3494 3496 3498 3500 3501 3502 3505 3566",
    ].join(" "),
  },
  {
    geography: "metropolitan",
    gasReticulated: false,
    climateRegion: "mild",
    climateZone: "4",
    postcodes: [
      "3758",
    ].join(" "),
  },
  {
    geography: "metropolitan",
    gasReticulated: false,
    climateRegion: "cold",
    climateZone: "4",
    postcodes: [
      "3762",
    ].join(" "),
  },
  {
    geography: "regional",
    gasReticulated: true,
    climateRegion: "mild",
    climateZone: "5",
    postcodes: [
      "3816 3818 3820 3822 3823 3824 3825",
    ].join(" "),
  },
] satisfies readonly CreditexVeuPostcodeGroup[];

const EXPECTED_GROUP_COUNTS: Readonly<Record<string, number>> = Object.freeze({
  "metropolitan|1|mild|4": 252,
  "metropolitan|1|mild|5": 4,
  "regional|1|mild|4": 49,
  "regional|0|mild|4": 82,
  "regional|0|cold|5": 66,
  "regional|1|cold|5": 17,
  "regional|0|mild|5": 8,
  "regional|0|cold|4": 113,
  "regional|1|cold|4": 49,
  "metropolitan|0|mild|5": 1,
  "metropolitan|1|cold|5": 6,
  "metropolitan|0|cold|5": 2,
  "metropolitan|1|cold|4": 14,
  "regional|0|hot|4": 39,
  "regional|1|hot|4": 8,
  "metropolitan|0|mild|4": 1,
  "metropolitan|0|cold|4": 1,
  "regional|1|mild|5": 7,
});

function tableIntegrityError(message: string): CreditexVeuPostcodeError {
  return new CreditexVeuPostcodeError(
    "VEU_POSTCODE_TABLE_INTEGRITY",
    message,
    "table",
  );
}

function locationClassFor(
  geography: CreditexVeuGeography,
  climateRegion: CreditexVeuClimateRegion,
): CreditexVeuLocationClass {
  if (geography === "metropolitan") {
    if (climateRegion === "hot") {
      throw tableIntegrityError("Table A contains an unsupported metropolitan/hot tuple.");
    }

    return climateRegion === "mild" ? "metro_mild" : "metro_cold";
  }

  if (climateRegion === "mild") return "regional_mild";
  if (climateRegion === "cold") return "regional_cold";
  return "regional_hot";
}

function fnv1a64Ascii(value: string): string {
  let hash = BigInt("14695981039346656037");
  const prime = BigInt("1099511628211");
  const mask = BigInt("18446744073709551615");

  for (let index = 0; index < value.length; index += 1) {
    const byte = value.charCodeAt(index);
    if (byte > 127) {
      throw tableIntegrityError("The canonical postcode table must remain ASCII.");
    }

    hash ^= BigInt(byte);
    hash = (hash * prime) & mask;
  }

  return hash.toString(16).padStart(16, "0");
}

function buildPostcodeTable(): {
  readonly rows: readonly CreditexVeuPostcodeRow[];
  readonly byPostcode: ReadonlyMap<string, CreditexVeuPostcodeRow>;
} {
  const byPostcode = new Map<string, CreditexVeuPostcodeRow>();
  const observedGroupCounts = new Map<string, number>();

  for (const group of POSTCODE_GROUPS) {
    const groupKey = [
      group.geography,
      group.gasReticulated ? "1" : "0",
      group.climateRegion,
      group.climateZone,
    ].join("|");
    const postcodes = group.postcodes.split(/\s+/u);
    observedGroupCounts.set(groupKey, postcodes.length);

    for (const postcode of postcodes) {
      if (!/^\d{4}$/u.test(postcode)) {
        throw tableIntegrityError(`Invalid postcode token in Table A: ${postcode}`);
      }
      if (byPostcode.has(postcode)) {
        throw tableIntegrityError(`Duplicate postcode in Table A: ${postcode}`);
      }

      const row = Object.freeze({
        postcode,
        geography: group.geography,
        gasReticulated: group.gasReticulated,
        climateRegion: group.climateRegion,
        climateZone: group.climateZone,
        locationClass: locationClassFor(group.geography, group.climateRegion),
      });
      byPostcode.set(postcode, row);
    }
  }

  const rows = Object.freeze(
    [...byPostcode.values()].sort((left, right) =>
      left.postcode.localeCompare(right.postcode),
    ),
  );
  if (rows.length !== CREDITEX_VEU_POSTCODE_TABLE_ROW_COUNT) {
    throw tableIntegrityError(
      `Expected ${CREDITEX_VEU_POSTCODE_TABLE_ROW_COUNT} Table A rows; found ${rows.length}.`,
    );
  }
  if (rows[0]?.postcode !== "3000" || rows.at(-1)?.postcode !== "3996") {
    throw tableIntegrityError("Table A boundary postcodes do not match the official table.");
  }

  const expectedGroupKeys = Object.keys(EXPECTED_GROUP_COUNTS).sort();
  const observedGroupKeys = [...observedGroupCounts.keys()].sort();
  if (expectedGroupKeys.join("|") !== observedGroupKeys.join("|")) {
    throw tableIntegrityError("Table A tuple coverage does not match the official table.");
  }
  for (const [key, expectedCount] of Object.entries(EXPECTED_GROUP_COUNTS)) {
    if (observedGroupCounts.get(key) !== expectedCount) {
      throw tableIntegrityError(`Table A tuple count mismatch for ${key}.`);
    }
  }

  const canonical = rows
    .map((row) =>
      [
        row.postcode,
        row.geography,
        row.gasReticulated ? "1" : "0",
        row.climateRegion,
        row.climateZone,
      ].join("|"),
    )
    .join("\n");
  const observedDigest = `fnv1a64:${fnv1a64Ascii(canonical)}`;
  if (observedDigest !== CREDITEX_VEU_POSTCODE_TABLE_DIGEST) {
    throw tableIntegrityError(
      `Table A digest mismatch: expected ${CREDITEX_VEU_POSTCODE_TABLE_DIGEST}; found ${observedDigest}.`,
    );
  }

  return Object.freeze({ rows, byPostcode });
}

const POSTCODE_TABLE = buildPostcodeTable();

export const CREDITEX_VEU_POSTCODE_ROWS = POSTCODE_TABLE.rows;

function parseInstallationDate(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new CreditexVeuPostcodeError(
      "VEU_POSTCODE_INVALID_INSTALLATION_DATE",
      "installationDate must be a real calendar date in YYYY-MM-DD format.",
      "installationDate",
    );
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new CreditexVeuPostcodeError(
      "VEU_POSTCODE_INVALID_INSTALLATION_DATE",
      "installationDate must be a real calendar date in YYYY-MM-DD format.",
      "installationDate",
    );
  }

  return value;
}

function sourceForDate(installationDate: string): CreditexVeuPostcodeSource {
  if (installationDate < CREDITEX_VEU_POSTCODE_SOURCES[0].effectiveFrom) {
    throw new CreditexVeuPostcodeError(
      "VEU_POSTCODE_DATE_UNSUPPORTED",
      "This resolver only contains the authoritative Version 24 and Version 25 postcode tables, effective from 2026-06-30.",
      "installationDate",
    );
  }

  return installationDate <= "2026-07-20"
    ? CREDITEX_VEU_POSTCODE_SOURCES[0]
    : CREDITEX_VEU_POSTCODE_SOURCES[1];
}

function parseRequest(request: unknown): CreditexVeuPostcodeRequest {
  if (typeof request !== "object" || request === null || Array.isArray(request)) {
    throw new CreditexVeuPostcodeError(
      "VEU_POSTCODE_INVALID_REQUEST",
      "A postcode and installationDate request object is required.",
      "request",
    );
  }

  const record = request as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.length !== 2 || keys[0] !== "installationDate" || keys[1] !== "postcode") {
    throw new CreditexVeuPostcodeError(
      "VEU_POSTCODE_INVALID_REQUEST",
      "The request must contain exactly postcode and installationDate.",
      "request",
    );
  }

  if (typeof record.postcode !== "string" || !/^\d{4}$/u.test(record.postcode)) {
    throw new CreditexVeuPostcodeError(
      "VEU_POSTCODE_INVALID_POSTCODE",
      "postcode must be an exact four-digit string.",
      "postcode",
    );
  }

  return Object.freeze({
    postcode: record.postcode,
    installationDate: parseInstallationDate(record.installationDate),
  });
}

export function resolveCreditexVeuPostcode(
  request: CreditexVeuPostcodeRequest,
): CreditexVeuPostcodeResolution;
export function resolveCreditexVeuPostcode(
  request: unknown,
): CreditexVeuPostcodeResolution {
  const parsed = parseRequest(request);
  const source = sourceForDate(parsed.installationDate);
  const row = POSTCODE_TABLE.byPostcode.get(parsed.postcode);
  if (!row) {
    throw new CreditexVeuPostcodeError(
      "VEU_POSTCODE_UNKNOWN",
      `Postcode ${parsed.postcode} is not an explicit row in the applicable VEU Table A.`,
      "postcode",
    );
  }

  return Object.freeze({
    ...row,
    isMetropolitan: row.geography === "metropolitan",
    isRegional: row.geography === "regional",
    source,
    tableRowCount: CREDITEX_VEU_POSTCODE_TABLE_ROW_COUNT,
    tableDigest: CREDITEX_VEU_POSTCODE_TABLE_DIGEST,
  });
}
