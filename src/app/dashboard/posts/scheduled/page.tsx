"use client";
import { useEffect, useState } from "react";


import API from "@/services/api";

function ScheduledPosts() {

const [posts,setPosts] =
useState<any[]>([]);

useEffect(()=>{

fetchScheduledPosts();

},[]);

async function fetchScheduledPosts(){

try{

const res =
await API.get(
"/posts/scheduled"
);

setPosts(
res.data.posts
);

}

catch(error){

console.log(error);

}

};

const cancelPost =
async(postId: number | string)=>{

try{

await API.put(
`/posts/update/${postId}`,
{
status:"ARCHIVED"
}
);

fetchScheduledPosts();

}

catch(error){

console.log(error);

}

};

return (
  <div>
    {
posts.length === 0 ? (

<div
className="
bg-white border border-slate-200
rounded-3xl
p-10
shadow-sm
text-center
"
>

<h2
className="
text-2xl
font-semibold
text-slate-900
mb-3
"
>

No Scheduled Posts

</h2>

<p className="text-slate-500">

Your scheduled posts
will appear here.

</p>

</div>

) : (

<div className="space-y-6">

{
posts.map((post)=>(

<div
key={post.id}
className="
bg-white border border-slate-200
rounded-3xl
p-6
shadow-sm
hover:shadow-md
transition
"
>

<div
className="
flex
justify-between
items-start
"
>

<div className="w-3/4">

<h2
className="
text-2xl
font-semibold
text-slate-900
"
>

{post.title}

</h2>

<p
className="
text-slate-600
mt-3
leading-relaxed
"
>

{post.content}

</p>

<div
className="
flex
gap-6
mt-5
text-sm
text-slate-500
"
>

<p>

Scheduled:
{" "}

{
new Date(
post.scheduledFor
).toLocaleString()
}

</p>

<p>

Created:
{" "}

{
new Date(
post.createdAt
).toLocaleString()
}

</p>

</div>

</div>

<div
className="
flex
flex-col
items-end
gap-4
"
>

<span
className="
px-5
py-2
rounded-full
bg-purple-100
text-purple-700
font-medium
"
>

{post.status}

</span>

<button
onClick={()=>
cancelPost(post.id)
}
className="
px-5
py-3
rounded-2xl
bg-red-100
text-red-700
hover:bg-red-200
"
>

Cancel

</button>

</div>

</div>

</div>

))
}

</div>

)
}

</div>

)

}

export default ScheduledPosts;