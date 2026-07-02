import Link from "next/link";
import { Rocket, X, Mail, Globe, MessageSquare } from "lucide-react";

export function Footer() {
  return (
    <footer className="py-20 px-6 border-t border-slate-200 bg-slate-50">
      <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-4 gap-12">
        <div className="col-span-1 md:col-span-1">
          <Link href="/" className="flex items-center gap-2 mb-6">
            <div className="w-8 h-8 bg-gradient-to-br from-primary to-secondary rounded-lg flex items-center justify-center shadow-sm">
              <Rocket className="text-white w-5 h-5" />
            </div>
            <span className="text-xl font-bold tracking-tight text-slate-900">
              GMB<span className="text-primary">Boost</span> AI
            </span>
          </Link>
          <p className="text-slate-500 text-sm leading-relaxed mb-6">
            The #1 AI-powered platform for local business growth and Google Business Profile automation.
          </p>
          <div className="flex gap-4">
            <Link href="#" className="w-10 h-10 rounded-full bg-white border border-slate-200 flex items-center justify-center hover:bg-slate-100 hover:text-primary text-slate-500 transition-all shadow-sm">
              <X className="w-5 h-5" />
            </Link>
            <Link href="#" className="w-10 h-10 rounded-full bg-white border border-slate-200 flex items-center justify-center hover:bg-slate-100 hover:text-primary text-slate-500 transition-all shadow-sm">
              <Globe className="w-5 h-5" />
            </Link>
            <Link href="#" className="w-10 h-10 rounded-full bg-white border border-slate-200 flex items-center justify-center hover:bg-slate-100 hover:text-primary text-slate-500 transition-all shadow-sm">
              <MessageSquare className="w-5 h-5" />
            </Link>
          </div>
        </div>

        <div>
          <h4 className="font-bold text-slate-900 mb-6">Product</h4>
          <ul className="space-y-4 text-sm text-slate-500">
            <li><Link href="#features" className="hover:text-primary transition-colors">Features</Link></li>
            <li><Link href="#pricing" className="hover:text-primary transition-colors">Pricing</Link></li>
            <li><Link href="#" className="hover:text-primary transition-colors">API</Link></li>
            <li><Link href="#" className="hover:text-primary transition-colors">Integrations</Link></li>
          </ul>
        </div>

        <div>
          <h4 className="font-bold text-slate-900 mb-6">Company</h4>
          <ul className="space-y-4 text-sm text-slate-500">
            <li><Link href="#" className="hover:text-primary transition-colors">About Us</Link></li>
            <li><Link href="#" className="hover:text-primary transition-colors">Blog</Link></li>
            <li><Link href="#" className="hover:text-primary transition-colors">Careers</Link></li>
            <li><Link href="#" className="hover:text-primary transition-colors">Contact</Link></li>
          </ul>
        </div>

        <div>
          <h4 className="font-bold text-slate-900 mb-6">Legal</h4>
          <ul className="space-y-4 text-sm text-slate-500">
            <li><Link href="#" className="hover:text-primary transition-colors">Terms of Service</Link></li>
            <li><Link href="#" className="hover:text-primary transition-colors">Privacy Policy</Link></li>
            <li><Link href="#" className="hover:text-primary transition-colors">Cookie Policy</Link></li>
          </ul>
        </div>
      </div>
      
      <div className="max-w-7xl mx-auto mt-20 pt-8 border-t border-slate-200 text-center text-slate-400 text-xs">
        © {new Date().getFullYear()} GMBBoost AI. All rights reserved. Built for the future of local SEO.
      </div>
    </footer>
  );
}
