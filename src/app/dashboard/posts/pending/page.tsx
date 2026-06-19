"use client";
import { useEffect, useState } from "react";


import API from "@/services/api";

function PendingPosts() {

const [posts,setPosts] =
useState<any[]>([]);

useEffect(()=>{

fetchPendingPosts();

},[]);

async function fetchPendingPosts(){

try{

const res =
await API.get(
"/posts/pending"
);

setPosts(
res.data.posts
);

}

catch(error){

console.log(error);

}

};

const approvePost =
async(postId: number | string)=>{

try{

await API.post(
`/posts/approve/${postId}`
);

fetchPendingPosts();

}

catch(error){

console.log(error);

}

};

const rejectPost =
async(postId: number | string)=>{

try{

await API.post(
`/posts/reject/${postId}`
);

fetchPendingPosts();

}

catch(error){

console.log(error);

}

};

return(

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

No Pending Posts

</h2>

<p className="text-slate-500">

Pending approval posts
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
"
>

{post.content}

</p>

</div>

<div
className="
flex
gap-3
"
>

<button
onClick={()=>
approvePost(post.id)
}
className="
px-5
py-3
rounded-2xl
bg-green-100
text-green-700
font-medium
hover:bg-green-200
"
>

Approve

</button>

<button
onClick={()=>
rejectPost(post.id)
}
className="
px-5
py-3
rounded-2xl
bg-red-100
text-red-700
font-medium
hover:bg-red-200
"
>

Reject

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

export default PendingPosts;