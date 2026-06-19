"use client";
import { useEffect, useState } from "react";


import API from "@/services/api";

import {
  useRouter
} from "next/navigation";

function MyPosts() {

  const router =
    useRouter();

  const [posts, setPosts] =
    useState<any[]>([]);

  useEffect(() => {

    fetchPosts();

  }, []);

  async function fetchPosts() {

      try {

        const res =
          await API.get(
            "/posts/my-posts"
          );

        setPosts(
          res.data.posts
        );

      }

      catch (error) {

        console.log(error);

      }

    };

  const deletePost =
    async (postId: number | string) => {

      try {

        await API.delete(
          `/posts/delete/${postId}`
        );

        fetchPosts();

      }

      catch (error) {

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
                text-2xl font-semibold text-slate-900
                mb-3
                "
              >

                No Posts Found

              </h2>

              <p className="text-slate-500">

                Your created posts
                will appear here.

              </p>

            </div>

          ) : (

            <div className="space-y-6">

              {

                posts.map((post) => (

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
                          text-2xl font-semibold text-slate-900
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

                        <p
                          className="
                          text-sm
                          text-slate-500
                          mt-4
                          "
                        >

                          Created:
                          {" "}
                          {
                            new Date(
                              post.createdAt
                            ).toLocaleString()
                          }

                        </p>

                        {
                          post.scheduledFor && (

                            <p
                              className="
                              text-sm
                              text-purple-500
                              mt-2
                              "
                            >

                              Scheduled:
                              {" "}
                              {
                                new Date(
                                  post.scheduledFor
                                ).toLocaleString()
                              }

                            </p>

                          )
                        }

                      </div>

                      <div
                        className="
                        flex
                        flex-col
                        items-end
                        gap-3
                        "
                      >

                        <span
                          className="
                          px-4
                          py-2
                          rounded-full
                          bg-blue-100
                          text-blue-700
                          font-medium
                          "
                        >

                          {post.status}

                        </span>

                        <div className="flex gap-3">

                          <button
                            onClick={() =>
                              router.push(
                                `/create-post?id=${post.id}`
                              )
                            }
                            className="
                            px-4
                            py-2
                            rounded-xl
                            bg-purple-100
                            text-purple-700
                            hover:bg-purple-200
                            "
                          >

                            Edit

                          </button>

                          <button
                            onClick={() =>
                              deletePost(post.id)
                            }
                            className="
                            px-4
                            py-2
                            rounded-xl
                            bg-red-100
                            text-red-700
                            hover:bg-red-200
                            "
                          >

                            Delete

                          </button>

                        </div>

                      </div>

                    </div>

                  </div>

                ))

              }

            </div>

          )

        }

      </div>

  );

}

export default MyPosts;