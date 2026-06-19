import { POST } from '../src/app/api/auth/register/route.ts';

async function test() {
  const req = {
    json: async () => ({
      fullName: 'Test User',
      email: 'test' + Date.now() + '@example.com',
      password: 'password123',
      companyName: 'Acme Corp',
      businessName: 'Acme Location',
      category: 'Tech',
      address: '123 Main',
      phone: '1234567890' + Date.now()
    })
  };
  
  // We can't directly call Next.js API in node easily due to Request object.
  // We'll mock it.
}
test();
