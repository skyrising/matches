dist: dist/matches.dot dist/matches.svg

dist/matches.dot:
	mkdir -p dist
	./dist.tsx

dist/matches.svg: dist/matches.dot
	dot dist/matches.dot -Tsvg > dist/matches.svg

.PHONY: clean
clean:
	rm -rf dist
