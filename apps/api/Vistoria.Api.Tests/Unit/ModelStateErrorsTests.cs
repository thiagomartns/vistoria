using AwesomeAssertions;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Vistoria.Api.Infrastructure.Errors;

namespace Vistoria.Api.Tests.Unit;

public class ModelStateErrorsTests
{
    private static readonly string[] Body = ["body"];

    [Theory]
    [InlineData("$.items[0].quantity", "items[0].quantity")]
    [InlineData("$.title", "title")]
    [InlineData("$", "")]
    [InlineData("$[0]", "[0]")]
    public void JsonPath_LosesDollarPrefix_AndGetsFixedMessage(string key, string expected)
    {
        var modelState = new ModelStateDictionary();
        modelState.AddModelError(key, "The JSON value could not be converted to Vistoria.Api.X. Path: $ | LineNumber: 0");

        var errors = ModelStateErrors.From(modelState, Body);

        errors.Should().ContainSingle().Which.Key.Should().Be(expected);
        errors[expected].Should().Equal(ModelStateErrors.InvalidValueMessage);
    }

    [Fact]
    public void ValidationKey_KeepsKeyAndMessages()
    {
        var modelState = new ModelStateDictionary();
        modelState.AddModelError("items[1].name", "Obrigatório.");
        modelState.AddModelError("items[1].name", "Máximo de 3 caracteres.");

        ModelStateErrors.From(modelState, Body)["items[1].name"]
            .Should().Equal("Obrigatório.", "Máximo de 3 caracteres.");
    }

    [Fact]
    public void BodyParameterError_IsDropped()
    {
        var modelState = new ModelStateDictionary();
        modelState.AddModelError("body", "The body field is required.");
        modelState.AddModelError("$.items[0].quantity", "The JSON value could not be converted.");

        ModelStateErrors.From(modelState, Body).Keys.Should().Equal("items[0].quantity");
    }

    [Fact]
    public void SamePathFromJsonAndValidation_IsMergedWithoutDuplicates()
    {
        var modelState = new ModelStateDictionary();
        modelState.AddModelError("", "A non-empty request body is required.");
        modelState.AddModelError("$", "The JSON value could not be converted.");

        var errors = ModelStateErrors.From(modelState, Body);

        errors.Keys.Should().Equal("");
        errors[""].Should().Equal("A non-empty request body is required.", ModelStateErrors.InvalidValueMessage);
    }
}
