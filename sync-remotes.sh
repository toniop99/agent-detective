#!/bin/bash
# Sync changes to both remotes: GitHub and Forgejo

echo "Pushing to GitHub..."
git push origin main

echo "Pushing to Forgejo..."
git push forgejo main

echo "Done!"
