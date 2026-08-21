"use client";

import { motion } from "framer-motion";
import { BookDemoButton } from "@/components/shared/BookDemoButton";

const NICHES = [
  { title: "Gym & Fitness Centres", image: "/marketing/home/niche-gym.png" },
  { title: "Doctors & Health Clinics", image: "/marketing/home/niche-doctor.png" },
  { title: "Bakers & Cake Shops", image: "/marketing/home/niche-baker.png" },
  { title: "Salon Owners", image: "/marketing/home/niche-salon.png" },
  { title: "Restaurants & Bars", image: "/marketing/home/niche-chef.png" },
  { title: "Pest Control Businesses", image: "/marketing/home/niche-pest.png" },
  { title: "Car Garages & Mechanics", image: "/marketing/home/niche-mechanic.png" },
  { title: "Tours & Travels", image: "/marketing/home/niche-travel.png" },
  { title: "Yoga & Wellness", image: "/marketing/home/niche-yoga.png" },
  { title: "Home Services", image: "/marketing/home/niche-handyman.png" },
];

export function BusinessNiches() {
  return (
    <section className="py-14 sm:py-20 md:py-28 px-4 sm:px-6 md:px-12 bg-[#f7faf8]">
      <div className="max-w-[1280px] mx-auto">
        <div className="text-center mb-10 sm:mb-12 md:mb-16">
          <h2 className="font-heading text-2xl sm:text-3xl md:text-5xl font-bold text-[#181c1c] tracking-tight mb-3 sm:mb-4">
            Built for Small Business Owners
          </h2>
          <p className="text-base sm:text-lg text-[#3d4a3d] max-w-2xl mx-auto leading-relaxed">
            Tailored AI marketing solutions designed specifically for the unique needs of local
            businesses and service providers.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6">
          {NICHES.map((niche, i) => (
            <motion.div
              key={niche.title}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.35, delay: i * 0.03 }}
              className="bg-white border border-[#e0e3e1] rounded-xl sm:rounded-2xl p-3.5 sm:p-4 min-h-[88px] sm:h-[114px] flex items-center justify-between gap-3"
            >
              <p className="font-semibold text-[#181c1c] text-sm sm:text-base leading-snug">{niche.title}</p>
              <img
                src={niche.image}
                alt=""
                className="w-12 h-14 sm:w-16 sm:h-20 object-contain shrink-0"
              />
            </motion.div>
          ))}

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="sm:col-span-2 lg:col-span-2 bg-[#006e2c] rounded-xl sm:rounded-2xl p-5 sm:p-6 min-h-[114px] flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4"
          >
            <p className="font-heading font-bold text-white text-lg sm:text-xl md:text-2xl leading-snug max-w-xs">
              And many more businesses like yours
            </p>
            <BookDemoButton
              origin="niches"
              className="w-full sm:w-auto justify-center px-6 py-3 rounded-lg bg-white text-[#006e2c] font-semibold hover:bg-[#f7faf8] transition-colors shrink-0 min-h-[48px]"
            />
          </motion.div>
        </div>
      </div>
    </section>
  );
}
