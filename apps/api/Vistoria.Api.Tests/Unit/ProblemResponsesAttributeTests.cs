using AwesomeAssertions;
using Vistoria.Api.Infrastructure.OpenApi;

namespace Vistoria.Api.Tests.Unit;

public class ProblemResponsesAttributeTests
{
    [Theory]
    [InlineData(200)]
    [InlineData(304)]
    [InlineData(600)]
    public void RejectsNonErrorStatus(int status)
    {
        var act = () => new ProblemResponsesAttribute(400, status);

        act.Should().Throw<ArgumentOutOfRangeException>();
    }

    [Fact]
    public void KeepsTheDeclaredStatuses()
    {
        new ProblemResponsesAttribute(404, 429).StatusCodes.Should().Equal(404, 429);
    }
}
