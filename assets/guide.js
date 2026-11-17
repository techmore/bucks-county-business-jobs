// Shared guide data for the browser (globals) and Node build tools (module.exports).
// Hiring statuses, typical hiring speed, and typical roles/skills per industry.
// Roles, skills and speed are typical for the industry, not promises from any one business.
(function (root) {
// ---- Hiring status (see tools/hiring-rules.js for how it's decided) ----
var STATUS = {
  hiring: { label: "Hiring", color: "#1f7a3f", note: "Openings seen on their own website or job system." },
  careers_page: { label: "Has a careers page", color: "#2f7fa3", note: "Has a careers page. Current openings not confirmed." },
  shared_site: { label: "Ask directly", color: "#c48a1c", note: "The careers page found belongs to a larger site (e.g. Peddler's Village). Ask the business." },
  no_online_info: { label: "No hiring info online", color: "#8a8478", note: "Many good local employers don't post jobs online. Call or stop in and ask." },
  not_checked: { label: "Not checked yet", color: "#c9c4b8", note: "Has a website we haven't checked yet." }
};


// ---- Industry guide: typical hiring speed, roles and skills. Typical for the industry, not this business. ----
var SPEED = {
  fast: { label: "Usually hires fast", detail: "often within 1-2 weeks", color: "#1f7a3f" },
  medium: { label: "Medium hiring speed", detail: "often 2-4 weeks", color: "#c48a1c" },
  slow: { label: "Slow, formal hiring", detail: "often 1-3 months (clearances, approvals)", color: "#a3472f" }
};

var INDUSTRY = {
  "Dining": { group: "Food & Drink", speed: "fast", roles: ["Server", "Line cook", "Dishwasher", "Host", "Barista"], skills: ["Customer service", "Food safety (ServSafe)", "Fast pace", "Weekend availability"] },
  "Specialty Food & Gifts": { group: "Food & Drink", speed: "fast", roles: ["Counter staff", "Baker", "Sales associate"], skills: ["Customer service", "Food handling", "Cash register"] },
  "Beer, Wine & Spirits": { group: "Food & Drink", speed: "fast", roles: ["Sales associate", "Stock", "Tasting room staff"], skills: ["Customer service", "Product knowledge", "21+"] },
  "Retail": { group: "Retail & Shops", speed: "fast", roles: ["Cashier", "Sales associate", "Stock associate", "Shift lead"], skills: ["Customer service", "Cash register / POS", "Merchandising"] },
  "Lifestyle & Home Decor": { group: "Retail & Shops", speed: "fast", roles: ["Sales associate", "Design consultant", "Stock"], skills: ["Customer service", "Eye for design", "POS"] },
  "Fashion & Accessories": { group: "Retail & Shops", speed: "fast", roles: ["Sales associate", "Stylist", "Stock"], skills: ["Customer service", "Visual merchandising"] },
  "Collectibles & Gifts": { group: "Retail & Shops", speed: "fast", roles: ["Sales associate", "Shop assistant"], skills: ["Customer service", "POS"] },
  "Toys, Books & Hobbies": { group: "Retail & Shops", speed: "fast", roles: ["Sales associate", "Shop assistant"], skills: ["Customer service", "Product knowledge"] },
  "Galleries & Artisans": { group: "Retail & Shops", speed: "medium", roles: ["Gallery assistant", "Studio assistant", "Sales"], skills: ["Art knowledge", "Sales", "Craft skills"] },
  "International": { group: "Retail & Shops", speed: "medium", roles: ["Sales associate", "Counter staff"], skills: ["Customer service", "Second language a plus"] },
  "Healthcare": { group: "Health", speed: "medium", roles: ["Medical assistant", "CNA / aide", "Front desk", "Billing", "Nurse"], skills: ["Patient care", "Medical records software", "Certifications (CNA, CMA, RN)", "HIPAA"] },
  "Beauty & Wellness": { group: "Health", speed: "medium", roles: ["Stylist", "Nail tech", "Front desk", "Massage therapist"], skills: ["State license", "Booking software", "Customer service"] },
  "Professional Services": { group: "Office & Professional", speed: "medium", roles: ["Office admin", "Receptionist", "Assistant", "Bookkeeper", "Paralegal"], skills: ["Phones & scheduling", "Microsoft / Google office tools", "Writing", "Organization"] },
  "Business Services": { group: "Office & Professional", speed: "medium", roles: ["Admin", "Sales rep", "Account coordinator", "IT support"], skills: ["Office software", "Communication", "Sales"] },
  "Financial & Services": { group: "Office & Professional", speed: "medium", roles: ["Teller", "Customer service rep", "Tax preparer", "Loan assistant"], skills: ["Cash handling", "Accuracy", "Phone skills"] },
  "Tech": { group: "Office & Professional", speed: "medium", roles: ["IT support", "Network admin", "Developer"], skills: ["Troubleshooting", "IT certifications", "Networking"] },
  "Manufacturing": { group: "Trades & Industry", speed: "medium", roles: ["Production worker", "Machine operator", "Warehouse", "Maintenance tech", "Quality control"], skills: ["Safety", "Forklift", "Mechanical aptitude"] },
  "Skilled Trades": { group: "Trades & Industry", speed: "medium", roles: ["Apprentice", "Laborer", "Electrician", "Plumber", "HVAC tech"], skills: ["Hand & power tools", "Trade license", "Driver's license"] },
  "Energy": { group: "Trades & Industry", speed: "medium", roles: ["Field tech", "Installer"], skills: ["Electrical basics", "Driver's license"] },
  "Logistics": { group: "Trades & Industry", speed: "fast", roles: ["Driver", "Warehouse associate", "Dispatcher"], skills: ["CDL or clean license", "Forklift", "Scheduling"] },
  "Agriculture": { group: "Trades & Industry", speed: "fast", roles: ["Farm hand", "Greenhouse worker", "Market staff"], skills: ["Physical work", "Equipment", "Seasonal availability"] },
  "Automotive": { group: "Automotive", speed: "fast", roles: ["Lube / tire tech", "Mechanic", "Service advisor", "Detailer"], skills: ["Tools", "ASE certification", "Driver's license", "Customer service"] },
  "Education": { group: "Schools & Government", speed: "slow", roles: ["Aide", "Substitute", "Teacher", "Bus driver", "Office / IT"], skills: ["PA clearances (Act 34/151/114)", "Teaching certificate for teachers", "Patience"] },
  "Government": { group: "Schools & Government", speed: "slow", roles: ["Clerk", "Maintenance", "Public safety", "IT"], skills: ["Civil service process", "Clearances", "Customer service"] },
  "Hospitality": { group: "Leisure & Hospitality", speed: "fast", roles: ["Front desk", "Housekeeping", "Banquet staff", "Maintenance"], skills: ["Customer service", "Flexible hours"] },
  "Lodging": { group: "Leisure & Hospitality", speed: "fast", roles: ["Front desk", "Housekeeping"], skills: ["Customer service", "Flexible hours"] },
  "Sports & Recreation": { group: "Leisure & Hospitality", speed: "fast", roles: ["Front desk", "Instructor / coach", "Groundskeeper", "Lifeguard"], skills: ["Customer service", "CPR / first aid", "Seasonal availability"] },
  "Family Fun": { group: "Leisure & Hospitality", speed: "fast", roles: ["Attendant", "Party host", "Front desk"], skills: ["Customer service", "Working with kids"] },
  "Services": { group: "Services", speed: "fast", roles: ["Technician", "Cleaner", "Driver", "Customer service"], skills: ["Reliability", "Driver's license", "Customer service"] },
  "Local Business": { group: "Services", speed: "medium", roles: ["General help", "Front counter"], skills: ["Customer service", "Reliability"] }
};
var DEFAULT_INDUSTRY = { group: "Services", speed: "medium", roles: ["General help"], skills: ["Customer service", "Reliability"] };

var GROUP_COLORS = {
  "Food & Drink": "#c0562f",
  "Retail & Shops": "#7a4fb0",
  "Health": "#c2417a",
  "Office & Professional": "#2f6fa3",
  "Trades & Industry": "#5f6b2f",
  "Automotive": "#3d3d3d",
  "Schools & Government": "#b5822b",
  "Leisure & Hospitality": "#1f8a8a",
  "Services": "#8a7d5f"
};


  var api = { STATUS: STATUS, SPEED: SPEED, INDUSTRY: INDUSTRY, DEFAULT_INDUSTRY: DEFAULT_INDUSTRY, GROUP_COLORS: GROUP_COLORS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof window !== "undefined" ? window : globalThis);
