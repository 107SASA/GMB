"use client";
import {
useEffect,
useState,
Suspense
}
from "react";

import {
useRouter,
useSearchParams
}
from "next/navigation";


import API
from "@/services/api";

function CreatePostContent() {

const router =
useRouter();

const searchParams = useSearchParams();

const postId =
searchParams.get("id");

const [loading,setLoading] =
useState(false);

const [aiLoading,setAiLoading] =
useState(false);

const [pageLoading,setPageLoading] =
useState(false);

const [formData,setFormData] =
useState({

title:"",
content:"",
scheduledFor:"",

});

useEffect(()=>{

if(postId){

fetchPost();

}

},[postId]);

const fetchPost =
async()=>{

try{

setPageLoading(true);

const res =
await API.get(
"/posts/my-posts"
);

const post =
res.data.posts.find(
(p: any)=>
p.id === Number(postId)
);

if(post){

setFormData({

title:
post.title || "",

content:
post.content || "",

scheduledFor:
post.scheduledFor
? new Date(post.scheduledFor)
.toISOString()
.slice(0,16)
: "",

});

}

}

catch(error){

console.log(error);

alert(
"Failed to fetch post"
);

}

finally{

setPageLoading(false);

}

};

const handleChange =
(e: any)=>{

setFormData({

...formData,

[e.target.name]:
e.target.value,

});

};

const handleAiGenerate =
async()=>{

try{

setAiLoading(true);

const response =
await API.get(
"/posts/generate-ai"
);

setFormData({

...formData,

title:
response.data.title,

content:
response.data.content,

});

}

catch(error){

console.log(error);

alert(
"AI generation failed"
);

}

finally{

setAiLoading(false);

}

};

const handleSubmit =
async(e: any)=>{

e.preventDefault();

try{

setLoading(true);

if(postId){

await API.put(
`/posts/update/${postId}`,
formData
);

alert(
"Post updated successfully"
);

}

else{

await API.post(
"/posts/create",
formData
);

alert(
"Post created successfully"
);

}

router.push(
"/my-posts"
);

}

catch(error){

console.log(error);

alert(
postId
? "Failed to update post"
: "Failed to create post"
);

}

finally{

setLoading(false);

}

};

if(pageLoading){

return(

<div className="p-10">

Loading...

</div>

);

}

return(
<div>

<form
onSubmit={handleSubmit}
className="
bg-white border border-slate-200
rounded-3xl
p-8
shadow-sm
space-y-6
"
>

<div>

<label
className="
block
text-slate-600
mb-2
"
>

Post Title

</label>

<input
type="text"
name="title"
value={formData.title}
onChange={handleChange}
placeholder="Enter post title"
required
className="
w-full
border
border-slate-200
rounded-2xl
p-4
outline-none
focus:border-primary
bg-slate-50
text-slate-900
shadow-sm
"
/>

</div>

<div>

<label
className="
block
text-slate-600
mb-2
"
>

Post Content

</label>

<textarea
rows={8}
name="content"
value={formData.content}
onChange={handleChange}
placeholder="Write your post content"
required
className="
w-full
border
border-slate-200
rounded-2xl
p-4
outline-none
focus:border-primary
bg-slate-50
text-slate-900
shadow-sm
"
/>

</div>

<div>

<label
className="
block
text-slate-600
mb-2
"
>

Schedule Date

</label>

<input
type="datetime-local"
name="scheduledFor"
value={formData.scheduledFor}
onChange={handleChange}
className="
w-full
border
border-slate-200
rounded-2xl
p-4
outline-none
focus:border-primary
bg-slate-50
text-slate-900
shadow-sm
[color-scheme:light]
"
/>

</div>

<div className="flex gap-4">

<button
type="submit"
disabled={loading}
className="
px-8
py-4
rounded-2xl
text-white
font-semibold
bg-gradient-to-r
from-blue-600
to-purple-600
shadow-md
hover:scale-105
transition
disabled:opacity-50
"
>

{
loading
? (
postId
? "Updating..."
: "Creating..."
)
: (
postId
? "Update Post"
: "Create Post"
)
}

</button>

<button
type="button"
onClick={handleAiGenerate}
disabled={aiLoading}
className="
px-8
py-4
rounded-2xl
border
border-purple-300
text-purple-700
font-semibold
hover:bg-purple-50
disabled:opacity-50
"
>

{
aiLoading
? "Generating..."
: "AI Generate"
}

</button>

</div>

</form>

</div>

)

}

export default function CreatePost() {
  return (
    <Suspense fallback={<div className="p-10 text-slate-500">Loading post data...</div>}>
      <CreatePostContent />
    </Suspense>
  );
}